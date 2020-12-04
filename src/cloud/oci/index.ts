import type { ConfigurationOptions } from 'aws-sdk/lib/core';
import type { Connection, ConnectionAttributes } from 'oracledb';

import { createBucket as createBucket_s3, deleteObjects as deleteObjects_s3 } from '../aws';

type CloudDatabase = functions.squared.CloudDatabase;
type InstanceHost = functions.internal.Cloud.InstanceHost;

const CACHE_DB: ObjectMap<any[]> = {};

export interface OCIStorageCredential extends ConfigurationOptions {
    region: string;
    namespace: string;
    endpoint?: string;
}

export interface OCIDatabaseCredential extends ConnectionAttributes {}

export interface OCIDatabaseQuery extends functions.squared.CloudDatabase<PlainObject | string> {}

export function validateStorage(credential: OCIStorageCredential) {
    return !!(credential.region && credential.namespace && credential.accessKeyId && credential.secretAccessKey);
}

export function validateDatabase(credential: OCIDatabaseCredential, data: CloudDatabase) {
    return !!(credential.user && credential.password && (credential.connectString || credential.connectionString) && data.table);
}

export function setStorageCredential(this: InstanceHost, credential: OCIStorageCredential) {
    credential.endpoint = `https://${credential.namespace}.compat.objectstorage.${credential.region}.oraclecloud.com`;
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
    setStorageCredential.call(this, credential);
    return deleteObjects_s3.call(this, credential, bucket, service);
}

export async function executeQuery(this: InstanceHost, credential: OCIDatabaseCredential, data: OCIDatabaseQuery, cacheKey?: string) {
    const connection = await createDatabaseClient.call(this, credential);
    let result: Undef<any[]>;
    try {
        const { table, id, query, limit = 0 } = data;
        if (cacheKey) {
            cacheKey += table;
        }
        if (id) {
            if (cacheKey) {
                cacheKey += id;
                if (CACHE_DB[cacheKey]) {
                    return CACHE_DB[cacheKey];
                }
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
            const keyId = typeof query === 'object' ? JSON.stringify(query) : query;
            const maxRows = Math.max(limit, 0);
            if (cacheKey) {
                cacheKey += keyId.replace(/\s+/g, '') + maxRows;
                if (CACHE_DB[cacheKey]) {
                    return CACHE_DB[cacheKey];
                }
            }
            if (typeof query === 'object') {
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
                result = (await connection.execute(query, [], { outFormat: 4002, maxRows })).rows;
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
        setStorageCredential,
        validateDatabase,
        createDatabaseClient,
        createBucket,
        deleteObjects,
        executeQuery
    };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}