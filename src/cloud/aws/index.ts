import type { ICloud, IModule } from '../../types/lib';
import type { CloudDatabase } from '../../types/lib/cloud';
import type { ConfigurationOptions } from 'aws-sdk/lib/core';
import type { ServiceConfigurationOptions } from 'aws-sdk/lib/service';

import { ERR_AWS, ERR_CLOUD } from '../index';

import type * as aws from 'aws-sdk';
import type * as awsS3 from 'aws-sdk/clients/s3';

export interface AWSStorageCredential extends ConfigurationOptions {
    fromPath?: string;
    profile?: string;
}

export interface AWSDatabaseCredential extends AWSStorageCredential, ServiceConfigurationOptions {}

export interface AWSDatabaseQuery extends CloudDatabase<aws.DynamoDB.QueryInput> {
    partitionKey?: string;
}

const AccessControlPolicy: aws.S3.Types.AccessControlPolicy = {
    Grants: [{
        Grantee: { Type: 'Group', URI: 'http://acs.amazonaws.com/groups/global/AllUsers' },
        Permission: 'READ'
    }]
};

function setPublicRead(this: IModule, s3: aws.S3, Bucket: string, service = 'aws') {
    const callback = (err: Null<Error>) => {
        if (!err) {
            this.formatMessage(this.logType.CLOUD, service, 'Grant public-read', Bucket, { titleColor: 'blue' });
        }
        else {
            this.formatMessage(this.logType.CLOUD, service, [ERR_CLOUD.GRANT_PUBLICREAD, Bucket], err, { titleColor: 'yellow' });
        }
    };
    switch (service) {
        case 'aws':
            s3.putBucketPolicy({ Bucket, Policy: getPublicReadPolicy(Bucket) }, callback);
            break;
        case 'ibm':
            s3.putBucketAcl({ Bucket, AccessControlPolicy }, callback);
            break;
    }
}

export function getPublicReadPolicy(bucket: string) {
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
    return !!(credential.accessKeyId && credential.secretAccessKey || credential.sessionToken || credential.fromPath || credential.profile || process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SDK_LOAD_CONFIG);
}

export function validateDatabase(credential: AWSDatabaseCredential, data: CloudDatabase) {
    return !!((credential.region || credential.endpoint) && data.table) && validateStorage(credential);
}

export function createStorageClient(this: IModule, credential: AWSStorageCredential, service = 'aws', sdk = 'aws-sdk/clients/s3') {
    try {
        if (service === 'aws') {
            const AWS = require('aws-sdk') as typeof aws;
            if (credential.fromPath) {
                const s3 = new AWS.S3();
                s3.config.loadFromPath(credential.fromPath);
                return s3;
            }
            let options: Undef<AWSStorageCredential>;
            if (credential.profile) {
                options = new AWS.SharedIniFileCredentials(credential);
            }
            else if (credential.accessKeyId && credential.secretAccessKey || credential.sessionToken) {
                options = credential;
            }
            return new AWS.S3(options);
        }
        const S3 = require(sdk) as typeof awsS3;
        return new S3(credential);
    }
    catch (err) {
        this.writeFail([`Install ${service.toUpperCase()} SDK?`, 'npm i ' + sdk.split('/')[0]]);
        throw err;
    }
}

export function createDatabaseClient(this: IModule, credential: AWSDatabaseCredential) {
    credential.endpoint ||= `https://dynamodb.${credential.region!}.amazonaws.com`;
    try {
        const AWS = require('aws-sdk') as typeof aws;
        let options: Undef<AWSDatabaseCredential>;
        if (credential.fromPath) {
            AWS.config.loadFromPath(credential.fromPath);
        }
        else if (credential.profile) {
            options = new AWS.SharedIniFileCredentials(credential);
        }
        else if (credential.accessKeyId && credential.secretAccessKey || credential.sessionToken) {
            options = credential;
        }
        return new AWS.DynamoDB.DocumentClient(options);
    }
    catch (err) {
        this.writeFail([ERR_AWS.INSTALL_AWS, 'npm i aws-sdk']);
        throw err;
    }
}

export async function createBucket(this: IModule, credential: ConfigurationOptions, Bucket: string, publicRead?: boolean, service = 'aws', sdk = 'aws-sdk/clients/s3') {
    const s3 = createStorageClient.call(this, credential, service, sdk);
    return await s3.headBucket({ Bucket }).promise()
        .then(() => {
            if (publicRead) {
                setPublicRead.call(this, s3, Bucket, service);
            }
            return true;
        })
        .catch(async () => {
            const input: aws.S3.CreateBucketRequest = { Bucket };
            const LocationConstraint = credential.region;
            if (typeof LocationConstraint === 'string' && LocationConstraint !== 'us-east-1') {
                input.CreateBucketConfiguration = { LocationConstraint };
            }
            return await s3.createBucket(input).promise()
                .then(() => {
                    this.formatMessage(this.logType.CLOUD, service, 'Bucket created', Bucket, { titleColor: 'blue' });
                    if (publicRead) {
                        setPublicRead.call(this, s3, Bucket, service);
                    }
                    return true;
                })
                .catch(err => {
                    if (err.code !== 'BucketAlreadyExists' && err.code !== 'BucketAlreadyOwnedByYou') {
                        this.formatFail(this.logType.CLOUD, service, [ERR_CLOUD.CREATE_BUCKET, Bucket], err);
                        return false;
                    }
                    return true;
                });
        });
}

export async function deleteObjects(this: IModule, credential: AWSStorageCredential, Bucket: string, service = 'aws', sdk = 'aws-sdk/clients/s3') {
    const s3 = createStorageClient.call(this, credential, service, sdk);
    try {
        const Contents = (await s3.listObjects({ Bucket }).promise()).Contents;
        if (Contents && Contents.length) {
            return s3.deleteObjects({ Bucket, Delete: { Objects: Contents.map(data => ({ Key: data.Key! })) } }).promise()
                .then(data => {
                    if (data.Deleted) {
                        this.formatMessage(this.logType.CLOUD, service, ['Bucket emptied', data.Deleted.length + ' files'], Bucket, { titleColor: 'blue' });
                    }
                });
        }
    }
    catch (err) {
        this.formatMessage(this.logType.CLOUD, service, [ERR_CLOUD.DELETE_BUCKET, Bucket], err, { titleColor: 'yellow' });
    }
}

export async function executeQuery(this: ICloud, credential: AWSDatabaseCredential, data: AWSDatabaseQuery, cacheKey?: string) {
    try {
        const { table, id, query, partitionKey, limit = 0 } = data;
        let result: Undef<unknown[]>,
            queryString = table!;
        const getClient = () => createDatabaseClient.call(this, { ...credential });
        const getCache = () => this.getDatabaseResult(data.service, credential, queryString, cacheKey);
        if (partitionKey && id) {
            queryString += partitionKey + id;
            if (result = getCache()) {
                return result;
            }
            const output = await getClient().get({ TableName: table!, Key: { [partitionKey]: id } }).promise();
            if (output.Item) {
                result = [output.Item];
            }
        }
        else if (query && typeof query === 'object') {
            queryString += JSON.stringify(query) + limit;
            if (result = getCache()) {
                return result;
            }
            query.TableName = table!;
            if (limit > 0) {
                query.Limit = limit;
            }
            const output = await getClient().query(query).promise();
            if (output.Count && output.Items) {
                result = output.Items;
            }
        }
        if (result) {
            this.setDatabaseResult(data.service, credential, queryString, result, cacheKey);
            return result;
        }
    }
    catch (err) {
        this.writeFail([ERR_CLOUD.QUERY_DB, data.service], err);
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
        executeQuery,
        getPublicReadPolicy
    };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}