import type * as gcs from '@google-cloud/storage';

import type { GCSCloudCredential } from '../index';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');

import { createClient, setPublicRead } from '../index';

type IFileManager = functions.IFileManager;
type UploadCallback = functions.internal.Cloud.UploadCallback;
type UploadHost = functions.internal.Cloud.UploadHost;
type UploadData = functions.internal.Cloud.UploadData<GCSCloudCredential>;

const BUCKET_MAP: ObjectMap<boolean> = {};

const getProjectId = (credential: GCSCloudCredential): string => require(path.resolve(credential.keyFilename || credential.keyFile!)).project_id || '';

function upload(this: IFileManager, service: string, credential: GCSCloudCredential): UploadCallback {
    const storage = createClient.call(this, service, credential);
    return async (data: UploadData, success: (value: string) => void) => {
        let bucketName = data.service.bucket ||= data.bucketGroup,
            bucket: Undef<gcs.Bucket>;
        if (!BUCKET_MAP[bucketName]) {
            try {
                const [exists] = await storage.bucket(bucketName).exists();
                if (!exists) {
                    storage.projectId = getProjectId(credential);
                    [bucket] = await storage.createBucket(bucketName, credential);
                    bucketName = bucket.name;
                    this.formatMessage(service, 'Bucket created', bucketName, 'blue');
                    if (data.service.admin?.publicRead) {
                        bucket.makePublic().then(() => setPublicRead.call(this, bucket!.acl.default, bucketName, true));
                    }
                }
            }
            catch (err) {
                if (err.code !== 409) {
                    this.formatMessage(service, ['Unable to create bucket', bucketName], err, 'red');
                    success('');
                    return;
                }
            }
            BUCKET_MAP[bucketName] = true;
        }
        bucket ||= storage.bucket(bucketName);
        const fileUri = data.fileUri;
        let filename = data.filename;
        if (!filename || !data.upload.overwrite) {
            filename ||= path.basename(fileUri);
            try {
                let exists = true,
                    i = 0,
                    j = 0;
                do {
                    if (i > 0) {
                        j = filename.indexOf('.');
                        if (j !== -1) {
                            filename = filename.substring(0, j) + `_${i}` + filename.substring(j);
                        }
                        else {
                            filename = uuid.v4() + path.extname(fileUri);
                            break;
                        }
                    }
                    [exists] = await bucket.file(filename).exists();
                }
                while (exists && ++i);
                if (i > 0) {
                    this.formatMessage(service, 'File renamed', filename, 'yellow');
                }
            }
            catch (err) {
                this.formatMessage(service, ['Unable to rename file', fileUri], err, 'red');
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
            const destUri = fileUri + path.extname(Key[i]);
            let srcUri = i === 0 ? fileUri : Body[i] as string;
            if (i === 0 || destUri !== srcUri) {
                srcUri = this.getTempDir() + uuid.v4() + path.sep + path.normalize(Key[i]);
                try {
                    fs.mkdirpSync(path.dirname(srcUri));
                }
                catch (err) {
                    this.formatMessage(service, ['Unable to create directory', srcUri], err, 'red');
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
                    this.formatMessage(service, ['Unable to write buffer', fileUri], err, 'red');
                    success('');
                    return;
                }
            }
            bucket.upload(srcUri, { contentType: ContentType[i] }, (err, file) => {
                if (file) {
                    const { active, endpoint, publicRead } = data.upload;
                    const url = (endpoint ? this.toPosix(endpoint) : 'https://storage.googleapis.com/' + bucketName) + '/' + Key[i];
                    this.formatMessage(service, 'Upload success', url);
                    if (i === 0) {
                        success(url);
                    }
                    if (publicRead || active && publicRead !== false) {
                        setPublicRead.call(this, file.acl, bucketName + '/' + Key[i], publicRead);
                    }
                }
                else if (i === 0) {
                    this.formatMessage(service, ['Upload failed', srcUri], err, 'red');
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

export default upload as UploadHost;