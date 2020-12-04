import type * as aws from 'aws-sdk';
import type { ConfigurationOptions } from 'aws-sdk/lib/core';

type InstanceHost = functions.internal.Cloud.InstanceHost;

export interface AWSStorageCredential extends ConfigurationOptions {
    endpoint?: string;
}

const AccessControlPolicy: aws.S3.Types.AccessControlPolicy = {
    Grants: [{
        Grantee: { Type: 'Group', URI: 'http://acs.amazonaws.com/groups/global/AllUsers' },
        Permission: 'READ'
    }]
};

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

export function validateStorage(credential: AWSStorageCredential) {
    return !!(credential.accessKeyId && credential.secretAccessKey);
}

export function createStorageClient(this: InstanceHost, credential: AWSStorageCredential, service = 'aws', sdk = 'aws-sdk/clients/s3') {
    try {
        const S3 = require(sdk) as Constructor<aws.S3>;
        return new S3(credential);
    }
    catch (err) {
        this.writeFail([`Install ${service} SDK?`, 'npm i aws-sdk']);
        throw err;
    }
}

export async function createBucket(this: InstanceHost, credential: ConfigurationOptions, Bucket: string, publicRead?: boolean, service = 'aws', sdk = 'aws-sdk/clients/s3') {
    const s3 = createStorageClient.call(this, credential, service, sdk);
    return await s3.headBucket({ Bucket })
        .promise()
        .then(() => {
            if (publicRead) {
                setPublicRead.call(this, s3, Bucket, service);
            }
            return true;
        })
        .catch(async () => {
            const bucketRequest = { Bucket } as aws.S3.CreateBucketRequest;
            if (credential.region) {
                bucketRequest.CreateBucketConfiguration = { LocationConstraint: credential.region };
            }
            return await s3.createBucket(bucketRequest)
                .promise()
                .then(() => {
                    this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Bucket created', Bucket, { titleColor: 'blue' });
                    if (publicRead) {
                        setPublicRead.call(this, s3, Bucket, service);
                    }
                    return true;
                })
                .catch(err => {
                    if (err.code !== 'BucketAlreadyExists' && err.code !== 'BucketAlreadyOwnedByYou') {
                        this.formatFail(this.logType.CLOUD_STORAGE, service, ['Unable to create bucket', Bucket], err);
                        return false;
                    }
                    return true;
                });
        });
}

export async function deleteObjects(this: InstanceHost, credential: AWSStorageCredential, Bucket: string, service = 'aws', sdk = 'aws-sdk/clients/s3') {
    try {
        const s3 = createStorageClient.call(this, credential, service, sdk);
        const Contents = (await s3.listObjects({ Bucket }).promise()).Contents;
        if (Contents && Contents.length) {
            return s3.deleteObjects({ Bucket, Delete: { Objects: Contents.map(data => ({ Key: data.Key! })) } })
                .promise()
                .then(data => {
                    if (data.Deleted) {
                        this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Bucket emptied', data.Deleted.length + ' files'], Bucket, { titleColor: 'blue' });
                    }
                });
        }
    }
    catch (err) {
        this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Unable to empty bucket', Bucket], err, { titleColor: 'yellow' });
    }
}

export function setPublicRead(this: InstanceHost, s3: aws.S3, Bucket: string, service = 'aws') {
    const callback = (err: Null<Error>) => {
        if (!err) {
            this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Grant public-read', Bucket, { titleColor: 'blue' });
        }
        else {
            this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Unable to grant public-read', Bucket], err, { titleColor: 'yellow' });
        }
    };
    switch (service) {
        case 'AWS':
            s3.putBucketPolicy({ Bucket, Policy: getPublicReadPolicy(Bucket) }, callback);
            break;
        case 'IBM':
            s3.putBucketAcl({ Bucket, AccessControlPolicy }, callback);
            break;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateStorage,
        createStorageClient,
        createBucket,
        deleteObjects,
        setPublicRead
    };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}