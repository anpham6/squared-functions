import type { ConfigurationOptions, SharedIniFileCredentials } from 'aws-sdk/lib/core';
import type { ServiceConfigurationOptions } from 'aws-sdk/lib/service';
import type * as aws from 'aws-sdk';

type InstanceHost = functions.internal.Cloud.InstanceHost;

export interface AWSStorageCredential extends ConfigurationOptions {
    fromPath?: string;
    profile?: string;
}

export interface AWSDatabaseCredential extends AWSStorageCredential, ServiceConfigurationOptions {}

export interface AWSDatabaseQuery extends functions.squared.CloudDatabase<aws.DynamoDB.QueryInput> {
    partitionKey?: string;
}

const CACHE_DB: ObjectMap<any[]> = {};

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

function setPublicRead(this: InstanceHost, s3: aws.S3, Bucket: string, service = 'aws') {
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

export function validateStorage(credential: AWSStorageCredential) {
    return !!(credential.accessKeyId && credential.secretAccessKey || credential.fromPath || credential.profile || process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SDK_LOAD_CONFIG);
}

export function validateDatabase(credential: AWSDatabaseCredential) {
    return validateStorage(credential) && !!(credential.region || credential.endpoint);
}

export function createStorageClient(this: InstanceHost, credential: AWSStorageCredential, service = 'aws', sdk = 'aws-sdk/clients/s3') {
    try {
        if (service === 'aws') {
            const AWS = require('aws-sdk');
            if (credential.fromPath) {
                const s3 = new AWS.S3() as aws.S3;
                s3.config.loadFromPath(credential.fromPath);
                return s3;
            }
            let options: Undef<AWSStorageCredential>;
            if (credential.profile) {
                options = new AWS.SharedIniFileCredentials(credential) as SharedIniFileCredentials;
            }
            else if (credential.accessKeyId && credential.secretAccessKey) {
                options = credential;
            }
            return new AWS.S3(options) as aws.S3;
        }
        const S3 = require(sdk) as Constructor<aws.S3>;
        return new S3(credential);
    }
    catch (err) {
        this.writeFail([`Install ${service.toUpperCase()} SDK?`, 'npm i ' + sdk.split('/')[0]]);
        throw err;
    }
}

export function createDatabaseClient(this: InstanceHost, credential: AWSDatabaseCredential) {
    credential.endpoint ||= `https://dynamodb.${credential.region!}.amazonaws.com`;
    try {
        const AWS = require('aws-sdk');
        let options: Undef<AWSDatabaseCredential>;
        if (credential.fromPath) {
            AWS.config.loadFromPath(credential.fromPath);
        }
        else if (credential.profile) {
            options = new AWS.SharedIniFileCredentials(credential) as SharedIniFileCredentials;
        }
        else if (credential.accessKeyId && credential.secretAccessKey) {
            options = credential;
        }
        return new AWS.DynamoDB.DocumentClient(options) as aws.DynamoDB.DocumentClient;
    }
    catch (err) {
        this.writeFail([`Install AWS SDK?`, 'npm i aws-sdk']);
        throw err;
    }
}

export async function createBucket(this: InstanceHost, credential: ConfigurationOptions, Bucket: string, publicRead?: boolean, service = 'aws', sdk = 'aws-sdk/clients/s3') {
    const s3 = createStorageClient.call(this, credential, service, sdk);
    return await s3.headBucket({ Bucket }).promise()
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
            return await s3.createBucket(bucketRequest).promise()
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
    const s3 = createStorageClient.call(this, credential, service, sdk);
    try {
        const Contents = (await s3.listObjects({ Bucket }).promise()).Contents;
        if (Contents && Contents.length) {
            return s3.deleteObjects({ Bucket, Delete: { Objects: Contents.map(data => ({ Key: data.Key! })) } }).promise()
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

export async function executeQuery(this: InstanceHost, credential: AWSDatabaseCredential, data: AWSDatabaseQuery, cacheKey?: string) {
    const client = createDatabaseClient.call(this, credential);
    let result: Undef<any[]>;
    try {
        const { table: TableName, id, query, partitionKey, limit = 0 } = data;
        if (cacheKey) {
            cacheKey += TableName;
        }
        if (partitionKey && id) {
            if (cacheKey) {
                cacheKey += partitionKey + id;
                if (CACHE_DB[cacheKey]) {
                    return CACHE_DB[cacheKey];
                }
            }
            const output = await client.get({ TableName, Key: { [partitionKey]: id } }).promise();
            if (output.Item) {
                result = [output.Item];
            }
        }
        else if (typeof query === 'object' && query !== null) {
            if (cacheKey) {
                cacheKey += JSON.stringify(query).replace(/\s+/g, '') + limit;
                if (CACHE_DB[cacheKey]) {
                    return CACHE_DB[cacheKey];
                }
            }
            query.TableName = TableName;
            if (limit > 0) {
                query.Limit = limit;
            }
            const output = await client.query(query).promise();
            if (output.Count && output.Items) {
                result = output.Items;
            }
        }
    }
    catch (err) {
        this.writeFail(['Unable to execute database query', data.service], err);
    }
    if (result) {
        if (cacheKey) {
            CACHE_DB[cacheKey] = result;
        }
        return result;
    }
    return [];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateStorage,
        validateDatabase,
        createStorageClient,
        createDatabaseClient,
        createBucket,
        deleteObjects,
        executeQuery
    };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}