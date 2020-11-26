import type * as aws from 'aws-sdk';

import type { S3CloudCredential } from '../index';

import path = require('path');
import uuid = require('uuid');

import { createClient, setPublicRead } from '../index';

type IFileManager = functions.IFileManager;
type UploadHost = functions.internal.Cloud.UploadHost;
type UploadCallback = functions.internal.Cloud.UploadCallback;
type UploadData = functions.internal.Cloud.UploadData;

const BUCKET_MAP: ObjectMap<boolean> = {};

function upload(this: IFileManager, credential: S3CloudCredential, service: string, sdk = 'aws-sdk/clients/s3'): UploadCallback {
    const s3 = createClient.call(this, credential, service, sdk);
    return async (data: UploadData, success: (value: string) => void) => {
        const Bucket = data.service.bucket ||= data.bucketGroup;
        const admin = data.service.admin;
        if (!BUCKET_MAP[service + Bucket] || admin?.publicRead) {
             const result = await s3.headBucket({ Bucket })
                .promise()
                .then(() => true)
                .catch(async () => {
                    const bucketRequest = { Bucket } as aws.S3.CreateBucketRequest;
                    if (credential.region) {
                        bucketRequest.CreateBucketConfiguration = { LocationConstraint: credential.region };
                    }
                    return await s3.createBucket(bucketRequest)
                        .promise()
                        .then(() => {
                            this.formatMessage(service, 'Bucket created', Bucket, 'blue');
                            BUCKET_MAP[service + Bucket] = true;
                            if (admin?.publicRead) {
                                setPublicRead.call(this, s3, Bucket, service);
                            }
                            return true;
                        })
                        .catch(err => {
                            if (err.code !== 'BucketAlreadyExists' && err.code !== 'BucketAlreadyOwnedByYou') {
                                this.formatMessage(service, ['Unable to create bucket', Bucket], err, 'red');
                                return false;
                            }
                            return true;
                        });
                });
            if (!result) {
                success('');
                return;
            }
        }
        const fileUri = data.fileUri;
        const pathname = data.service.upload?.pathname || '';
        let filename = data.filename;
        if (!filename || !data.upload.overwrite) {
            filename ||= path.basename(fileUri);
            try {
                const originalName = filename;
                let exists: Undef<boolean>,
                    i = 0,
                    j = 0;
                do {
                    if (i > 0) {
                        j = filename.indexOf('.');
                        if (j !== -1) {
                            filename = originalName.substring(0, j) + `_${i}` + originalName.substring(j);
                        }
                        else {
                            filename = uuid.v4() + path.extname(fileUri);
                            break;
                        }
                    }
                    exists = await s3.headObject({ Bucket, Key: pathname + filename })
                        .promise()
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
                    this.formatMessage(service, 'File renamed', filename, 'yellow');
                }
            }
            catch (err) {
                this.formatMessage(service, ['Unable to rename file', fileUri], err, 'red');
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
                    const url = endpoint ? this.toPosix(endpoint, result.Key) : result.Location;
                    this.formatMessage(service, 'Upload success', url);
                    if (i === 0) {
                        success(url);
                    }
                }
                else if (i === 0) {
                    this.formatMessage(service, ['Upload failed', fileUri], err, 'red');
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