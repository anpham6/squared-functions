import type * as aws from 'aws-sdk';

import type { S3CloudCredential } from '../index';

import path = require('path');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;

type UploadOptions = functions.internal.Cloud.UploadOptions<S3CloudCredential>;
type UploadCallback = functions.internal.Cloud.UploadCallback;

const BUCKET_MAP: ObjectMap<boolean> = {};

function uploadS3(this: IFileManager, credential: S3CloudCredential, serviceName: string): UploadCallback {
    let s3: aws.S3;
    try {
        const S3 = require('aws-sdk/clients/s3') as Constructor<aws.S3>;
        s3 = new S3(credential);
    }
    catch (err) {
        this.writeFail('Install SDK? [npm i aws-sdk]', serviceName);
        throw err;
    }
    return async (buffer: Buffer, options: UploadOptions, success: (value?: unknown) => void) => {
        const Bucket = credential.bucket || uuid.v4();
        const bucketService = serviceName + Bucket;
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
                            this.writeMessage('Bucket created', Bucket, serviceName, 'blue');
                            return BUCKET_MAP[bucketService] = true;
                        })
                        .catch(err => {
                            this.writeFail(`${serviceName}: Unable to create bucket`, err);
                            return false;
                        });
                });
            if (!result) {
                success('');
                return;
            }
        }
        const fileUri = options.fileUri;
        let filename = options.filename;
        if (!filename) {
            const renameFile = () => this.writeMessage(`File renamed [${filename!}]`, filename = uuid.v4() + path.extname(fileUri), serviceName, 'yellow');
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
        const { active, publicAccess, apiEndpoint } = options.upload;
        const ACL = publicAccess || active && publicAccess !== false ? 'public-read' : '';
        const Key = [filename];
        const Body = [buffer];
        const ContentType = [options.mimeType];
        for (const item of options.fileGroup) {
            Body.push(item[0] as Buffer);
            Key.push(filename + item[1]);
        }
        for (let i = 0; i < Key.length; ++i) {
            s3.upload({ Bucket, Key: Key[i], ACL, Body: Body[i], ContentType: ContentType[i] }, (err, result) => {
                if (!err) {
                    const url = apiEndpoint ? apiEndpoint.replace(/\/*$/, '') + '/' + Key[i] : result.Location;
                    this.writeMessage('Upload success', url, serviceName);
                    if (i === 0) {
                        success(url);
                    }
                }
                else if (i === 0) {
                    this.writeFail(`${serviceName}: Upload failed (${fileUri})`, err);
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

export default uploadS3;