import type { ICloud, Internal } from '../../types/lib';
import type { CloudDatabase } from '../../types/lib/squared';
import type { ConfigurationOptions } from 'aws-sdk/lib/core';
import type { Connection, ConnectionAttributes } from 'oracledb';

import { createBucket as createBucket_s3, deleteObjects as deleteObjects_s3 } from '../aws';

type InstanceHost = Internal.Cloud.InstanceHost;

const OUT_FORMAT_OBJECT = 4002;

export interface OCIStorageCredential extends ConfigurationOptions {
    namespace?: string;
    endpoint?: string;
}

export interface OCIDatabaseCredential extends ConnectionAttributes {}

export interface OCIDatabaseQuery extends CloudDatabase<PlainObject | string> {}

export function validateStorage(credential: OCIStorageCredential) {
    return !!(credential.accessKeyId && credential.secretAccessKey && (credential.region && credential.namespace || credential.endpoint));
}

export function validateDatabase(credential: OCIDatabaseCredential, data: CloudDatabase) {
    return !!(credential.user && credential.password && (credential.connectString || credential.connectionString) && data.table);
}

export function setStorageCredential(credential: OCIStorageCredential) {
    credential.endpoint ||= `https://${credential.namespace!}.compat.objectstorage.${credential.region!}.oraclecloud.com`;
    credential.region ||= /([^.]+)\.oraclecloud\.com$/.exec(credential.endpoint)?.[1];
    credential.s3ForcePathStyle = true;
    credential.signatureVersion = 'v4';
}

export async function createDatabaseClient(this: InstanceHost, credential: OCIDatabaseCredential) {
    try {
        const oracledb = require('oracledb');
        oracledb.autoCommit = true;
        return await oracledb.getConnection(credential) as Connection;
    }
    catch (err) {
        this.writeFail([`Install Oracle DB?`, 'npm i oracledb']);
        throw err;
    }
}

export async function createBucket(this: InstanceHost, credential: OCIStorageCredential, bucket: string, publicRead?: boolean) {
    return createBucket_s3.call(this, credential, bucket, publicRead, 'oci');
}

export async function deleteObjects(this: InstanceHost, credential: OCIStorageCredential, bucket: string, service = 'oci') {
    setStorageCredential(credential);
    return deleteObjects_s3.call(this, credential, bucket, service);
}

export async function executeQuery(this: ICloud, credential: OCIDatabaseCredential, data: OCIDatabaseQuery, cacheKey?: string) {
    const connection = await createDatabaseClient.call(this, credential);
    let result: Undef<any[]>,
        queryString = '';
    try {
        const { table, id, query, limit = 0 } = data;
        queryString = table;
        if (id) {
            queryString += id;
            result = this.getDatabaseResult(data.service, credential, queryString, cacheKey);
            if (result) {
                return result;
            }
            const collection = await connection.getSodaDatabase().openCollection(table);
            if (collection) {
                const item = await collection.find().key(id).getOne();
                if (item) {
                    result = [item.getContent()];
                }
            }
        }
        else if (query && !Array.isArray(query)) {
            const maxRows = Math.max(limit, 0);
            if (typeof query === 'object') {
                queryString += JSON.stringify(query) + maxRows;
                result = this.getDatabaseResult(data.service, credential, queryString, cacheKey);
                if (result) {
                    return result;
                }
                const collection = await connection.getSodaDatabase().openCollection(data.table);
                if (collection) {
                    let operation = collection.find().filter(query);
                    if (maxRows > 0) {
                        operation = operation.limit(maxRows);
                    }
                    result = (await operation.getDocuments()).map(item => item.getContent());
                }
            }
            else {
                queryString += query + (data.params ? JSON.stringify(data.params) : '') + (data.options ? JSON.stringify(data.options) : '') + maxRows;
                result = this.getDatabaseResult(data.service, credential, queryString, cacheKey);
                if (result) {
                    return result;
                }
                result = (await connection.execute(query, data.params || [], { ...data.options, outFormat: OUT_FORMAT_OBJECT, maxRows })).rows;
            }
        }
    }
    catch (err) {
        this.writeFail(['Unable to execute database query', data.service], err);
    }
    if (result) {
        this.setDatabaseResult(data.service, credential, queryString, result, cacheKey);
        return result;
    }
    return [];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateStorage,
        setStorageCredential,
        validateDatabase,
        createDatabaseClient,
        createBucket,
        deleteObjects,
        executeQuery
    };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}