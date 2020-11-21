import type * as aws from 'aws-sdk';

import type { S3CloudCredential } from '../index';

import path = require('path');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;
type UploadData = functions.internal.Cloud.UploadData<S3CloudCredential>;
type UploadHost = functions.internal.Cloud.UploadHost;
type UploadCallback = functions.internal.Cloud.UploadCallback;

const BUCKET_MAP: ObjectMap<boolean> = {};

function uploadS3(this: IFileManager, service: string, credential: S3CloudCredential): UploadCallback {
    let s3: aws.S3;
    try {
        const S3 = require('aws-sdk/clients/s3') as Constructor<aws.S3>;
        s3 = new S3(credential);
    }
    catch (err) {
        this.writeFail(`Install ${service} SDK? [npm i aws-sdk]`);
        throw err;
    }
    return async (data: UploadData, success: (value: string) => void) => {
        if (!credential.bucket) {
            data.storage.bucket = data.bucketGroup;
            credential.bucket = data.bucketGroup;
        }
        const Bucket = credential.bucket;
        const bucketService = service + Bucket;
        if (!BUCKET_MAP[bucketService]) {
            const result = await s3.headBucket({ Bucket })
                .promise()
                .then(() => BUCKET_MAP[bucketService] = true)
                .catch(async () => {
                    const bucketRequest = { Bucket } as aws.S3.CreateBucketRequest;
                    if (credential.region) {
                        bucketRequest.CreateBucketConfiguration = { LocationConstraint: credential.region };
                    }
                    return await s3.createBucket(bucketRequest)
                        .promise()
                        .then(() => {
                            this.writeMessage('Bucket created', Bucket, service, 'blue');
                            return BUCKET_MAP[bucketService] = true;
                        })
                        .catch(err => {
                            this.writeMessage(`Unable to create bucket [${Bucket}]`, err, service, 'red');
                            return false;
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
            const renameFile = () => this.writeMessage(`File renamed [${filename!}]`, filename = uuid.v4() + path.extname(fileUri), service, 'yellow');
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
        const { active, publicAccess, apiEndpoint } = data.upload;
        const ACL = publicAccess || active && publicAccess !== false ? 'public-read' : '';
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
                    this.writeMessage('Upload success', url, service);
                    if (i === 0) {
                        success(url);
                    }
                }
                else if (i === 0) {
                    this.writeMessage(`Upload failed [${fileUri}]`, err, service, 'red');
                    success('');
                }
            });
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadS3;
    module.exports.default = uploadS3;
    module.exports.__esModule = true;
}

export default uploadS3 as UploadHost;