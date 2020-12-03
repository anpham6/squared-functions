import type { ConfigurationOptions } from 'ibm-cos-sdk/lib/config';
import type { MangoQuery } from 'nano';
import type * as db from '@cloudant/cloudant';

import { deleteObjects as deleteObjects_s3 } from '../aws';

type IFileManager = functions.IFileManager;
type ICloud = functions.ICloud;
type CloudDatabase = functions.squared.CloudDatabase;

const CACHE_DB: ObjectMap<any[]> = {};

export interface IBMStorageCredential extends ConfigurationOptions {
    endpoint?: string;
}

export interface IBMDatabaseCredential extends db.Configuration {}

export interface IBMDatabaseQuery extends functions.squared.CloudDatabase<MangoQuery> {
    partitionKey?: string;
}

export function validateStorage(credential: IBMStorageCredential) {
    return !!(credential.apiKeyId && credential.serviceInstanceId);
}

export function validateDatabase(credential: IBMDatabaseCredential, data: CloudDatabase) {
    return !!((credential.account && credential.password || credential.url) && data.table);
}

export function setStorageCredential(this: ICloud | IFileManager, credential: IBMStorageCredential) {
    credential.region ||= 'us-east';
    credential.endpoint ||= `https://s3.${credential.region}.cloud-object-storage.appdomain.cloud`;
    credential.ibmAuthEndpoint = 'https://iam.cloud.ibm.com/identity/token';
    credential.signatureVersion = 'iam';
}

export function createDatabaseClient(this: ICloud | IFileManager, credential: IBMDatabaseCredential) {
    try {
        const Cloudant = require('@cloudant/cloudant');
        return new Cloudant(credential) as db.ServerScope;
    }
    catch (err) {
        this.writeFail([`Install IBM Cloudant?`, 'npm i @cloudant/cloudant']);
        throw err;
    }
}

export async function deleteObjects(this: ICloud, credential: IBMStorageCredential, bucket: string, service = 'ibm') {
    setStorageCredential.call(this, credential);
    return deleteObjects_s3.call(this, credential as PlainObject, bucket, service, 'ibm-cos-sdk/clients/s3');
}

export async function executeQuery(this: ICloud | IFileManager, credential: IBMDatabaseCredential, data: IBMDatabaseQuery, cacheKey?: string) {
    const client = createDatabaseClient.call(this, credential);
    let result: Undef<any[]>;
    try {
        const { table, id, query, partitionKey = '', limit = 0 } = data;
        const scope = client.db.use(table);
        if (cacheKey) {
            cacheKey += table;
        }
        if (id) {
            if (cacheKey) {
                cacheKey += partitionKey + id;
                if (CACHE_DB[cacheKey]) {
                    return CACHE_DB[cacheKey];
                }
            }
            const item = await scope.get((partitionKey ? partitionKey + ':' : '') + id);
            result = [item];
        }
        else if (typeof query === 'object' && query !== null) {
            if (cacheKey) {
                cacheKey += JSON.stringify(query).replace(/\s+/g, '') + limit;
                if (CACHE_DB[cacheKey]) {
                    return CACHE_DB[cacheKey];
                }
            }
            if (limit > 0) {
                query.limit ||= limit;
            }
            if (partitionKey) {
                result = (await scope.partitionedFind(partitionKey, query)).docs;
            }
            else {
                result = (await scope.find(query)).docs;
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
        deleteObjects,
        executeQuery
    };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}