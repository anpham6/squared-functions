import type { IModule } from '../../../types/lib';
import type { UploadData } from '../../../types/lib/cloud';

import type { UploadCallback } from '../../index';

import { ERR_MESSAGE } from '../../../types/lib/logger';
import { ERR_CLOUD } from '../../index';

import path = require('path');
import fs = require('fs');
import uuid = require('uuid');

import Module from '../../../module';

import { GCloudStorageCredential, createBucket, createStorageClient, setPublicRead } from '../index';

const BUCKET_MAP = new Set<string>();

export default function upload(this: IModule, credential: GCloudStorageCredential, service = 'gcloud'): UploadCallback {
    const storage = createStorageClient.call(this, credential);
    return async (data: UploadData, success: (value: string) => void) => {
        const bucket = data.bucket ||= data.upload.bucketGroup || uuid.v4();
        if (!BUCKET_MAP.has(bucket)) {
            if (!await createBucket.call(this, credential, bucket, data.admin?.publicRead)) {
                success('');
                return;
            }
            BUCKET_MAP.add(bucket);
        }
        const bucketClient = storage.bucket(bucket);
        const localUri = data.localUri;
        const pathname = data.upload.pathname || '';
        let filename = data.filename;
        if (!filename || !data.upload.overwrite) {
            filename ||= path.basename(localUri);
            try {
                let i = 0,
                    exists: Undef<boolean>,
                    basename: Undef<string>,
                    suffix: Undef<string>;
                do {
                    if (i > 0) {
                        if (i === 1) {
                            const index = filename.indexOf('.');
                            if (index !== -1) {
                                basename = filename.substring(0, index);
                                suffix = filename.substring(index);
                                const match = /^(.+?)_(\d+)$/.exec(basename);
                                if (match) {
                                    basename = match[1];
                                    i = parseInt(match[2]) + 1;
                                }
                            }
                        }
                        if (basename) {
                            filename = basename + `_${i}` + suffix;
                        }
                        else {
                            filename = uuid.v4() + path.extname(localUri);
                            break;
                        }
                    }
                    [exists] = await bucketClient.file(pathname + filename).exists();
                }
                while (exists && ++i);
                if (i > 0) {
                    this.formatMessage(this.logType.CLOUD, service, 'File renamed', filename, { titleColor: 'yellow' });
                }
            }
            catch (err) {
                this.formatFail(this.logType.CLOUD, service, [ERR_MESSAGE.RENAME_FILE, localUri], err);
                success('');
                return;
            }
        }
        const Key = [filename];
        const Body: [Buffer, ...string[]] = [data.buffer];
        const ContentType = [data.mimeType];
        for (const item of data.fileGroup) {
            Body.push(item[0] as string);
            Key.push(filename + item[1]);
        }
        for (let i = 0; i < Key.length; ++i) {
            const destUri = localUri + path.extname(Key[i]);
            let srcUri = i === 0 ? localUri : Body[i] as string;
            if (i === 0 || destUri !== srcUri) {
                srcUri = this.getTempDir(true) + path.normalize(Key[i]);
                const dirname = path.dirname(srcUri);
                if (!Module.mkdirSafe(dirname, true)) {
                    success('');
                    return;
                }
                try {
                    if (i === 0) {
                        fs.writeFileSync(srcUri, Body[0]);
                    }
                    else {
                        fs.copyFileSync(destUri, srcUri);
                    }
                }
                catch (err) {
                    this.writeFail([ERR_MESSAGE.WRITE_FILE, localUri], err, this.logType.FILE);
                    success('');
                    return;
                }
            }
            bucketClient.upload(srcUri, { contentType: ContentType[i], destination: pathname ? pathname + path.basename(srcUri) : undefined }, (err, file) => {
                if (file) {
                    const { active, endpoint, publicRead } = data.upload;
                    const url = Module.joinPath(endpoint ? endpoint : 'https://storage.googleapis.com/' + bucket, file.name);
                    this.formatMessage(this.logType.CLOUD, service, 'Upload success', url);
                    if (i === 0) {
                        success(url);
                    }
                    if (publicRead || active && publicRead !== false) {
                        setPublicRead.call(this, file.acl, Module.joinPath(bucket, file.name), publicRead);
                    }
                }
                else if (i === 0) {
                    this.formatFail(this.logType.CLOUD, service, [ERR_CLOUD.UPLOAD_FAIL, srcUri], err);
                    success('');
                }
            });
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = upload;
    module.exports.default = upload;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}