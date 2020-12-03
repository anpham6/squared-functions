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
        const connection = await oracledb.getConnection(credential) as db.Connection;
        return connection.getSodaDatabase();
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

export async function deleteObjects(this: ICloud, credential: OCIStorageCredential, bucket: string, service = 'OCI') {
    setStorageCredential.call(this, credential);
    return deleteObjects_s3.call(this, credential, bucket, service);
}

export async function execDatabaseQuery(this: ICloud | IFileManager, credential: OCIDatabaseCredential, data: OCIDatabaseQuery, cacheKey?: string) {
    const client = await createDatabaseClient.call(this, credential);
    let result: Undef<any[]>;
    try {
        const collection = await client.openCollection(data.table!);
        if (collection) {
            if (cacheKey) {
                cacheKey += data.name + data.table!;
            }
            if (data.id) {
                if (cacheKey) {
                    cacheKey += data.id;
                    if (CACHE_DB[cacheKey]) {
                        return CACHE_DB[cacheKey];
                    }
                }
                const item = await collection.find().key(data.id).getOne();
                if (item) {
                    result = [item.getContent()];
                }
            }
            else if (data.query) {
                const [query, keyId] = typeof data.query === 'object' ? [data.query, JSON.stringify(data.query)] : [JSON.parse(data.query) as PlainObject, data.query];
                if (cacheKey) {
                    cacheKey += keyId.replace(/\s+/g, '');
                    if (CACHE_DB[cacheKey]) {
                        return CACHE_DB[cacheKey];
                    }
                }
                result = (await collection.find().filter(query).getDocuments()).map(item => item.getContent());
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