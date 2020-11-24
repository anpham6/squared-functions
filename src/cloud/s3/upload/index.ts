import type * as aws from 'aws-sdk';

import type { S3CloudCredential } from '../index';

import path = require('path');
import uuid = require('uuid');

import { createClient, setPublicRead } from '../index';

type IFileManager = functions.IFileManager;
type UploadHost = functions.internal.Cloud.UploadHost;
type UploadCallback = functions.internal.Cloud.UploadCallback;
type UploadData = functions.internal.Cloud.UploadData<S3CloudCredential>;

const BUCKET_MAP: ObjectMap<boolean> = {};

function upload(this: IFileManager, service: string, credential: S3CloudCredential, sdk = 'aws-sdk/clients/s3'): UploadCallback {
    const s3 = createClient.call(this, service, credential, sdk);
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
        let filename = data.filename;
        if (!filename) {
            const renameFile = () => this.formatMessage(service, ['File renamed', filename!], filename = uuid.v4() + path.extname(fileUri), 'yellow');
            filename = path.basename(fileUri);
            await s3.headObject({ Bucket, Key: filename })
                .promise()
                .then(() => renameFile())
                .catch(err => {
                    if (err.code !== 'NotFound') {
                        renameFile();
                    }
                });
        }
        const { active, publicRead, apiEndpoint } = data.upload;
        const ACL = publicRead || active && publicRead !== false ? 'public-read' : '';
        const Key = [filename];
        const Body = [data.buffer];
        const ContentType = [data.mimeType];
        for (const item of data.fileGroup) {
            Body.push(item[0] as Buffer);
            Key.push(filename + item[1]);
        }
        for (let i = 0; i < Key.length; ++i) {
            s3.upload({ Bucket, Key: Key[i], ACL, Body: Body[i], ContentType: ContentType[i] }, (err, result) => {
                if (!err) {
                    const url = apiEndpoint ? this.toPosix(apiEndpoint, Key[i]) : result.Location;
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