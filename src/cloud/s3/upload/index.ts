import type * as aws from 'aws-sdk';

import type { S3CloudCredentials } from '../index';

import uuid = require('uuid');

type IFileManager = functions.IFileManager;

type CloudUploadOptions = functions.external.CloudUploadOptions<S3CloudCredentials>;

const BUCKET_MAP: ObjectMap<boolean> = {};

function uploadHandlerS3(this: IFileManager, credentials: S3CloudCredentials, serviceName: string) {
    let s3: aws.S3;
    try {
        const S3 = require('aws-sdk/clients/s3') as Constructor<aws.S3>;
        s3 = new S3(credentials);
    }
    catch (err) {
        this.writeFail('Install SDK? [npm i aws-sdk]', serviceName);
        throw err;
    }
    return async (buffer: Buffer, success: (value?: unknown) => void, options: CloudUploadOptions) => {
        const Bucket = credentials.bucket || uuid.v4();
        const bucketService = serviceName + Bucket;
        let ACL: Undef<string>;
        if (!BUCKET_MAP[bucketService]) {
            try {
                await s3.headBucket({ Bucket }).promise();
                BUCKET_MAP[bucketService] = true;
            }
            catch (err) {
                if (err.code === 'NotFound') {
                    BUCKET_MAP[bucketService] = false;
                }
            }
            try {
                if (!BUCKET_MAP[bucketService]) {
                    const { active, publicAccess } = options.config;
                    const bucketRequest = { Bucket } as aws.S3.CreateBucketRequest;
                    if (credentials.region) {
                        bucketRequest.CreateBucketConfiguration = { LocationConstraint: credentials.region };
                    }
                    if (publicAccess || active && publicAccess !== false) {
                        ACL = 'public-read';
                    }
                    await s3.createBucket(bucketRequest).promise();
                    this.writeMessage('Bucket created', Bucket, serviceName, 'blue');
                }
                BUCKET_MAP[bucketService] = true;
            }
            catch (err) {
                this.writeFail(`${serviceName}: Unable to create bucket`, err);
                success('');
                return;
            }
        }
        s3.upload({ Bucket, Key: options.filename, ACL, Body: buffer, ContentType: options.mimeType }, (err, result) => {
            if (err) {
                this.writeFail(`${serviceName}: Upload failed (${options.fileUri})`, err);
                success('');
            }
            else {
                const apiEndpoint = options.config.apiEndpoint;
                const url = apiEndpoint ? apiEndpoint.replace(/\/*$/, '') + '/' + options.filename : result.Location;
                this.writeMessage('Upload', url, serviceName);
                success(url);
            }
        });
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadHandlerS3;
    module.exports.default = uploadHandlerS3;
    module.exports.__esModule = true;
}

export default uploadHandlerS3;