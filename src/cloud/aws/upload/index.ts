import type { IModule } from '../../../types/lib';
import type { UploadData } from '../../../types/lib/cloud';

import type { UploadCallback } from '../../index';

import path = require('path');
import uuid = require('uuid');

import Module from '../../../module';

import { AWSStorageCredential, createBucket, createStorageClient } from '../index';

const BUCKET_MAP: ObjectMap<boolean> = {};

export default function upload(this: IModule, credential: AWSStorageCredential, service = 'aws', sdk = 'aws-sdk/clients/s3'): UploadCallback {
    const s3 = createStorageClient.call(this, credential, service, sdk);
    return async (data: UploadData, success: (value: string) => void) => {
        const Bucket = data.bucket ||= data.bucketGroup || uuid.v4();
        const admin = data.admin;
        if (!BUCKET_MAP[service + Bucket] || admin?.publicRead) {
            if (!await createBucket.call(this, credential, Bucket, admin?.publicRead, service, sdk)) {
                success('');
                return;
            }
            BUCKET_MAP[service + Bucket] = true;
        }
        const localUri = data.localUri;
        const pathname = data.upload?.pathname || '';
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
                    exists = await s3.headObject({ Bucket, Key: pathname + filename }).promise()
                        .then(() => true)
                        .catch(err => {
                            if (err.code !== 'NotFound') {
                                filename = uuid.v4() + path.extname(localUri);
                            }
                            return false;
                        });
                }
                while (exists && ++i);
                if (i > 0) {
                    this.formatMessage(this.logType.CLOUD, service, 'File renamed', filename, { titleColor: 'yellow' });
                }
            }
            catch (err) {
                this.formatFail(this.logType.CLOUD, service, ['Unable to rename file', path.basename(localUri)], err);
                success('');
                return;
            }
        }
        if (pathname) {
            await s3.putObject({ Bucket, Key: pathname, Body: Buffer.from(''), ContentLength: 0 }).promise();
        }
        const { active, publicRead, endpoint } = data.upload;
        const ACL = publicRead || active && publicRead !== false ? 'public-read' : '';
        const Key = [filename];
        const Body = [data.buffer];
        const ContentType = [data.mimeType];
        for (const item of data.fileGroup) {
            Body.push(item[0] as Buffer);
            Key.push(filename + item[1]);
        }
        for (let i = 0; i < Key.length; ++i) {
            s3.upload({ Bucket, Key: pathname + Key[i], ACL, Body: Body[i], ContentType: ContentType[i] }, (err, result) => {
                if (!err) {
                    const url = endpoint ? Module.joinPosix(endpoint, result.Key) : result.Location;
                    this.formatMessage(this.logType.CLOUD, service, 'Upload success', url);
                    if (i === 0) {
                        success(url);
                    }
                }
                else if (i === 0) {
                    this.formatFail(this.logType.CLOUD, service, ['Upload failed', path.basename(localUri)], err);
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