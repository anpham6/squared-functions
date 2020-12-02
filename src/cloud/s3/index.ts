import type * as aws from 'aws-sdk';
import type { ConfigurationOptions } from 'aws-sdk/lib/core';

type IFileManager = functions.IFileManager;
type ICloud = functions.ICloud;

export interface S3StorageCredential extends ConfigurationOptions {
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

export function validateStorage(credential: S3StorageCredential) {
    return !!(credential.accessKeyId && credential.secretAccessKey);
}

export function createStorageClient(this: ICloud | IFileManager, credential: S3StorageCredential, service = 'S3', sdk = 'aws-sdk/clients/s3') {
    try {
        const S3 = require(sdk) as Constructor<aws.S3>;
        return new S3(credential);
    }
    catch (err) {
        this.writeFail([`Install ${service} SDK?`, 'npm i aws-sdk']);
        throw err;
    }
}

export async function deleteObjects(this: ICloud, credential: S3StorageCredential, Bucket: string, service = 'S3', sdk = 'aws-sdk/clients/s3') {
    try {
        const s3 = createStorageClient.call(this, credential, service, sdk);
        const Contents = (await s3.listObjects({ Bucket }).promise()).Contents;
        if (Contents && Contents.length) {
            return s3.deleteObjects({ Bucket, Delete: { Objects: Contents.map(data => ({ Key: data.Key! })) } })
                .promise()
                .then(data => {
                    if (data.Deleted) {
                        this.formatMessage(service, ['Bucket emptied', data.Deleted.length + ' files'], Bucket, 'blue');
                    }
                });
        }
    }
    catch (err) {
        this.formatMessage(service, ['Unable to empty bucket', Bucket], err, 'yellow');
    }
}

export function setPublicRead(this: IFileManager, s3: aws.S3, Bucket: string, service = 'S3') {
    const callback = (err: Null<Error>) => {
        if (!err) {
            this.formatMessage(service, 'Grant public-read', Bucket, 'blue');
        }
        else {
            this.formatMessage(service, ['Unable to grant public-read', Bucket], err, 'yellow');
        }
    };
    switch (service) {
        case 'S3':
            s3.putBucketPolicy({ Bucket, Policy: getPublicReadPolicy(Bucket) }, callback);
            break;
        case 'IBM':
            s3.putBucketAcl({ Bucket, AccessControlPolicy }, callback);
            break;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateStorage, createStorageClient, deleteObjects, setPublicRead };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}