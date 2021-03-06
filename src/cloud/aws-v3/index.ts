import type { ICloud, IModule } from '../../types/lib';
import type { CloudDatabase } from '../../types/lib/cloud';

import type { Credentials, Provider } from '@aws-sdk/types';

import type * as s3 from '@aws-sdk/client-s3';
import type * as dynamodb from '@aws-sdk/client-dynamodb';
import type * as documentdb from '@aws-sdk/lib-dynamodb';
import type * as credential from '@aws-sdk/credential-provider-ini';

import { ERR_AWS, ERR_CLOUD } from '../index';
import { getPublicReadPolicy } from '../aws/index';

interface AWSBaseConfig {
    profile?: string;
}

export interface AWSStorageConfig extends s3.S3ClientConfig, AWSBaseConfig {
    credentials?: Credentials | Provider<Credentials>;
}

export interface AWSDatabaseConfig extends dynamodb.DynamoDBClientConfig, AWSBaseConfig {}

export interface AWSDatabaseQuery extends CloudDatabase<dynamodb.QueryInput> {
    partitionKey?: string;
}

function setPublicRead(this: IModule, S3: typeof s3, client: s3.S3Client, Bucket: string, service = 'aws-v3') {
    client.send(new S3.PutBucketPolicyCommand({ Bucket, Policy: getPublicReadPolicy(Bucket) }))
        .then(() => {
            this.formatMessage(this.logType.CLOUD, service, 'Grant public-read', Bucket, { titleColor: 'blue' });
        })
        .catch(err => {
            this.formatMessage(this.logType.CLOUD, service, [ERR_CLOUD.GRANT_PUBLICREAD, err.Endpoint || Bucket], err, { titleColor: 'yellow' });
        });
}

export function validateStorage(config: AWSStorageConfig, lib = '@aws-sdk/client-s3') {
    if (config.profile) {
        try {
            const { fromIni } = require('@aws-sdk/credential-provider-ini') as typeof credential;
            config.credentials = fromIni(config);
        }
        catch (err) {
            throw new Error(lib + ': ' + (err instanceof Error ? err.message : err));
        }
        return true;
    }
    const credentials = config.credentials as Undef<Credentials>;
    return !!credentials && !!(credentials.accessKeyId && credentials.secretAccessKey || credentials.sessionToken);
}

export function validateDatabase(config: AWSDatabaseConfig, data: CloudDatabase) {
    return !!((config.region || config.endpoint) && data.table) && validateStorage(config, '@aws-sdk/client-dynamodb');
}

export function createBucket(this: IModule, config: AWSStorageConfig, Bucket: string, publicRead?: boolean, service = 'aws-v3', sdk = '@aws-sdk/client-s3') {
    try {
        const AWS = require(sdk) as typeof s3;
        try {
            const client = new AWS.S3Client(config);
            return client.send(new AWS.HeadBucketCommand({ Bucket }))
                .then(() => {
                    if (publicRead) {
                        setPublicRead.call(this, AWS, client, Bucket, service);
                    }
                    return true;
                })
                .catch(() => {
                    const input: s3.CreateBucketRequest = { Bucket };
                    const LocationConstraint = config.region;
                    if (typeof LocationConstraint === 'string' && LocationConstraint !== 'us-east-1') {
                        input.CreateBucketConfiguration = { LocationConstraint };
                    }
                    return client.send(new AWS.CreateBucketCommand(input))
                        .then(() => {
                            this.formatMessage(this.logType.CLOUD, service, 'Bucket created', Bucket, { titleColor: 'blue' });
                            if (publicRead) {
                                setPublicRead.call(this, AWS, client, Bucket, service);
                            }
                            return true;
                        })
                        .catch(err => {
                            if (err.message !== 'BucketAlreadyExists' && err.message !== 'BucketAlreadyOwnedByYou') {
                                this.formatFail(this.logType.CLOUD, service, [ERR_CLOUD.CREATE_BUCKET, Bucket], err);
                                return false;
                            }
                            if (publicRead) {
                                setPublicRead.call(this, AWS, client, Bucket, service);
                            }
                            return true;
                        });
                });
        }
        catch (err) {
            this.formatMessage(this.logType.CLOUD, service, [ERR_CLOUD.CREATE_BUCKET, Bucket], err, { titleColor: 'yellow' });
        }
        return Promise.resolve(false);
    }
    catch (err) {
        this.writeFail([ERR_AWS.INSTALL_AWS3, 'npm i ' + sdk]);
        throw err;
    }
}

export async function deleteObjects(this: IModule, config: AWSStorageConfig, Bucket: string, service = 'aws-v3', sdk = '@aws-sdk/client-s3') {
    try {
        const AWS = require(sdk) as typeof s3;
        try {
            const client = new AWS.S3Client(config);
            const Contents = (await client.send(new AWS.ListObjectsCommand({ Bucket }))).Contents;
            if (Contents && Contents.length) {
                return client.send(new AWS.DeleteObjectsCommand({ Bucket, Delete: { Objects: Contents.map(data => ({ Key: data.Key! })) } }))
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
    catch (err) {
        this.writeFail([ERR_AWS.INSTALL_AWS3, 'npm i ' + sdk]);
        throw err;
    }
}

export async function executeQuery(this: ICloud, config: AWSDatabaseConfig, data: AWSDatabaseQuery, cacheKey?: string) {
    if (!config.endpoint && typeof config.region === 'string') {
        config.endpoint = `https://dynamodb.${config.region}.amazonaws.com`;
    }
    try {
        const { DynamoDBClient } = require('@aws-sdk/client-dynamodb') as typeof dynamodb;
        try {
            const AWS = require('@aws-sdk/lib-dynamodb') as typeof documentdb;
            try {
                const client = AWS.DynamoDBDocumentClient.from(new DynamoDBClient(config));
                const { table: TableName, id, query, partitionKey, limit = 0 } = data;
                let result: Undef<unknown[]>,
                    queryString = TableName!;
                const getCache = () => this.getDatabaseResult(data.service, config, queryString, cacheKey);
                if (partitionKey && id) {
                    queryString += partitionKey + id;
                    if (result = getCache()) {
                        return result;
                    }
                    const output = await client.send(new AWS.GetCommand({ TableName, Key: { [partitionKey]: id } }));
                    if (output.Item) {
                        result = [output.Item];
                    }
                }
                else if (typeof query === 'object') {
                    queryString += JSON.stringify(query) + limit;
                    if (result = getCache()) {
                        return result;
                    }
                    query.TableName = TableName;
                    if (limit > 0) {
                        query.Limit = limit;
                    }
                    const output = await client.send(new AWS.QueryCommand(query));
                    if (output.Count && output.Items) {
                        result = output.Items;
                    }
                }
                if (result) {
                    this.setDatabaseResult(data.service, config, queryString, result, cacheKey);
                    return result;
                }
            }
            catch (err) {
                this.writeFail([ERR_CLOUD.QUERY_DB, data.service], err);
            }
        }
        catch (err) {
            this.writeFail([ERR_AWS.INSTALL_DYNAMODB, 'npm i @aws-sdk/lib-dynamodb']);
            throw err;
        }
    }
    catch (err) {
        this.writeFail([ERR_AWS.INSTALL_DYNAMODB, 'npm i @aws-sdk/client-dynamodb']);
        throw err;
    }
    return [];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateStorage,
        validateDatabase,
        createBucket,
        deleteObjects,
        executeQuery
    };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}