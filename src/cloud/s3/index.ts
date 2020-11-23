import type { S3 } from 'aws-sdk';
import type { ConfigurationOptions } from 'aws-sdk/lib/core';

type IFileManager = functions.IFileManager;

export interface S3CloudCredential extends ConfigurationOptions {
    endpoint?: string;
}

export interface S3CloudBucket extends functions.squared.CloudService {
    bucket?: string;
}

function getPublicReadPolicy(bucket: string) {
    return JSON.stringify({
        "Version": "2012-10-17",
        "Statement": [{
            "Sid": "PublicRead",
            "Effect": "Allow",
            "Principal": "*",
            "Action": ["s3:GetObject", "s3:GetObjectVersion"],
            "Resource": [`arn:aws:s3:::${bucket}/*`]
        }]
    });
}

export function setPublicRead(this: IFileManager, s3: S3, Bucket: string, service = 'S3') {
    if (typeof s3.putBucketPolicy === 'function') {
        s3.putBucketPolicy({ Bucket, Policy: getPublicReadPolicy(Bucket) }, err => {
            if (err) {
                this.formatMessage(service, ['Unable to grant public-read', Bucket], err, 'yellow');
            }
        });
    }
}

export default function validate(credential: S3CloudCredential) {
    return !!(credential.accessKeyId && credential.secretAccessKey);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate, setPublicRead };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}