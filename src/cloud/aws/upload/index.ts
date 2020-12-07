import type { AWSStorageCredential } from '../index';

import path = require('path');
import uuid = require('uuid');

import { createBucket, createStorageClient } from '../index';

type InstanceHost = functions.internal.Cloud.InstanceHost;
type UploadHost = functions.internal.Cloud.UploadHost;
type UploadData = functions.internal.Cloud.UploadData;
type UploadCallback = functions.internal.Cloud.UploadCallback;

const BUCKET_MAP: ObjectMap<boolean> = {};

function upload(this: InstanceHost, credential: AWSStorageCredential, service = 'aws', sdk = 'aws-sdk/clients/s3'): UploadCallback {
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
        const fileUri = data.fileUri;
        const pathname = data.upload?.pathname || '';
        let filename = data.filename;
        if (!filename || !data.upload.overwrite) {
            filename ||= path.basename(fileUri);
            try {
                const originalName = filename;
                const index = originalName.indexOf('.');
                let i = 0,
                    exists: Undef<boolean>;
                do {
                    if (i > 0) {
                        if (index !== -1) {
                            filename = originalName.substring(0, index) + `_${i}` + originalName.substring(index);
                        }
                        else {
                            filename = uuid.v4() + path.extname(fileUri);
                            break;
                        }
                    }
                    exists = await s3.headObject({ Bucket, Key: pathname + filename }).promise()
                        .then(() => true)
                        .catch(err => {
                            if (err.code !== 'NotFound') {
                                filename = uuid.v4() + path.extname(fileUri);
                            }
                            return false;
                        });
                }
                while (exists && ++i);
                if (i > 0) {
                    this.formatMessage(this.logType.CLOUD_STORAGE, service, 'File renamed', filename, { titleColor: 'yellow' });
                }
            }
            catch (err) {
                this.formatFail(this.logType.CLOUD_STORAGE, service, ['Unable to rename file', path.basename(fileUri)], err);
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
                    const url = endpoint ? this.joinPosix(endpoint, result.Key) : result.Location;
                    this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Upload success', url);
                    if (i === 0) {
                        success(url);
                    }
                }
                else if (i === 0) {
                    this.formatFail(this.logType.CLOUD_STORAGE, service, ['Upload failed', path.basename(fileUri)], err);
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