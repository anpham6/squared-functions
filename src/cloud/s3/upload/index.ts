import type * as aws from 'aws-sdk';

import type { S3CloudCredentials } from '../index';

import path = require('path');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;

type CloudUploadOptions = functions.internal.Cloud.CloudUploadOptions<S3CloudCredentials>;
type CloudUploadCallback = functions.internal.Cloud.CloudUploadCallback;

const BUCKET_MAP: ObjectMap<boolean> = {};

function uploadS3(this: IFileManager, credentials: S3CloudCredentials, serviceName: string): CloudUploadCallback {
    let s3: aws.S3;
    try {
        const S3 = require('aws-sdk/clients/s3') as Constructor<aws.S3>;
        s3 = new S3(credentials);
    }
    catch (err) {
        this.writeFail('Install SDK? [npm i aws-sdk]', serviceName);
        throw err;
    }
    return async (buffer: Buffer, options: CloudUploadOptions, success: (value?: unknown) => void) => {
        const Bucket = credentials.bucket || uuid.v4();
        const bucketService = serviceName + Bucket;
        let ACL: Undef<string>;
        if (!BUCKET_MAP[bucketService]) {
            await s3.headBucket({ Bucket })
                .promise()
                .then(() => BUCKET_MAP[bucketService] = true)
                .catch(() => BUCKET_MAP[bucketService] = false);
            try {
                if (!BUCKET_MAP[bucketService]) {
                    const { active, publicAccess } = options.upload;
                    const bucketRequest = { Bucket } as aws.S3.CreateBucketRequest;
                    if (credentials.region) {
                        bucketRequest.CreateBucketConfiguration = { LocationConstraint: credentials.region };
                    }
                    if (publicAccess || active && publicAccess !== false) {
                        ACL = 'public-read';
                    }
                    await s3.createBucket(bucketRequest).promise();
                    this.writeMessage('Bucket created', Bucket, serviceName, 'blue');
                    BUCKET_MAP[bucketService] = true;
                }
            }
            catch (err) {
                this.writeFail(`${serviceName}: Unable to create bucket`, err);
                success('');
                return;
            }
        }
        let Key = options.filename;
        if (!Key) {
            Key = path.basename(options.fileUri);
            const renameFile = () => this.writeMessage(`File renamed [${Key!}]`, Key = uuid.v4() + path.extname(options.fileUri), serviceName, 'yellow');
            await s3.headObject({ Bucket, Key })
                .promise()
                .then(() => renameFile())
                .catch(err => {
                    if (err.code !== 'NotFound') {
                        renameFile();
                    }
                });
        }
        s3.upload({ Bucket, Key, ACL, Body: buffer, ContentType: options.mimeType }, (err, result) => {
            if (!err) {
                const apiEndpoint = options.upload.apiEndpoint;
                const url = apiEndpoint ? apiEndpoint.replace(/\/*$/, '') + '/' + Key : result.Location;
                this.writeMessage('Upload success', url, serviceName);
                success(url);
            }
            else {
                this.writeFail(`${serviceName}: Upload failed (${options.fileUri})`, err);
                success('');
            }
        });
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadS3;
    module.exports.default = uploadS3;
    module.exports.__esModule = true;
}

export default uploadS3;