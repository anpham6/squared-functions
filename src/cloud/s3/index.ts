import type * as aws from 'aws-sdk';
import type * as awsCore from 'aws-sdk/lib/core';

type IFileManager = functions.IFileManager;

export interface S3CloudCredential extends awsCore.ConfigurationOptions {
    bucket?: string;
    endpoint?: string;
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

export function setPublicRead(this: IFileManager, s3: aws.S3, Bucket: string, service = 'S3') {
    s3.putBucketPolicy({ Bucket, Policy: getPublicReadPolicy(Bucket) }, err => {
        if (err) {
            this.writeMessage(`Unable to grant public-read [${Bucket}]`, err, service, 'yellow');
        }
    });
}

export default function validate(config: S3CloudCredential) {
    return !!(config.accessKeyId && config.secretAccessKey);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate, setPublicRead };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}