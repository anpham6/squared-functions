import type { ConfigurationOptions } from 'aws-sdk/lib/core';
import type * as db from 'oracledb';

import { deleteObjects as deleteObjects_s3 } from '../aws';

type IFileManager = functions.IFileManager;
type ICloud = functions.ICloud;
type CloudDatabase = functions.squared.CloudDatabase;

const CACHE_DB: ObjectMap<any[]> = {};

export interface OCIStorageCredential extends ConfigurationOptions {
    region: string;
    namespace: string;
    endpoint?: string;
}

export interface OCIDatabaseCredential extends db.ConnectionAttributes {}

export interface OCIDatabaseQuery extends functions.squared.CloudDatabase {}

export function validateStorage(credential: OCIStorageCredential) {
    return !!(credential.region && credential.namespace && credential.accessKeyId && credential.secretAccessKey);
}

export function validateDatabase(credential: OCIDatabaseCredential, data: CloudDatabase) {
    return !!(credential.user && credential.password && (credential.connectString || credential.connectionString) && data.table);
}

export async function createDatabaseClient(this: ICloud | IFileManager, credential: OCIDatabaseCredential) {
    try {
        const oracledb = require('oracledb');
        return await oracledb.getConnection(credential) as db.Connection;
    }
    catch (err) {
        this.writeFail([`Install Oracle DB?`, 'npm i oracledb']);
        throw err;
    }
}

export function setStorageCredential(this: ICloud | IFileManager, credential: OCIStorageCredential) {
    credential.endpoint = `https://${credential.namespace}.compat.objectstorage.${credential.region}.oraclecloud.com`;
    credential.s3ForcePathStyle = true;
    credential.signatureVersion = 'v4';
}

export async function deleteObjects(this: ICloud, credential: OCIStorageCredential, bucket: string, service = 'oci') {
    setStorageCredential.call(this, credential);
    return deleteObjects_s3.call(this, credential, bucket, service);
}

export async function execDatabaseQuery(this: ICloud | IFileManager, credential: OCIDatabaseCredential, data: OCIDatabaseQuery, cacheKey?: string) {
    const connection = await createDatabaseClient.call(this, credential);
    let result: Undef<any[]>;
    try {
        if (cacheKey) {
            cacheKey += data.table;
        }
        if (data.id) {
            if (cacheKey) {
                cacheKey += data.id;
                if (CACHE_DB[cacheKey]) {
                    return CACHE_DB[cacheKey];
                }
            }
            const collection = await connection.getSodaDatabase().openCollection(data.table);
            if (collection) {
                const item = await collection.find().key(data.id).getOne();
                if (item) {
                    result = [item.getContent()];
                }
            }
        }
        else if (data.query) {
            const [query, keyId] = typeof data.query === 'object' ? [data.query, JSON.stringify(data.query)] : [data.query, data.query];
            const maxRows = Math.max(data.limit || 0, 0);
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
    module.exports = { validateStorage, setStorageCredential, deleteObjects, validateDatabase, createDatabaseClient, execDatabaseQuery };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}