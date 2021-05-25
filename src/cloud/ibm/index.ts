import type { ICloud, IModule } from '../../types/lib';
import type { CloudDatabase } from '../../types/lib/cloud';

import type { ConfigurationOptions } from 'ibm-cos-sdk/lib/config';
import type { Configuration, ServerScope } from '@cloudant/cloudant';
import type { MangoQuery } from 'nano';

import { createBucket as createBucket_s3, deleteObjects as deleteObjects_s3 } from '../aws';

export interface IBMStorageCredential extends ConfigurationOptions {
    endpoint?: string;
}

export interface IBMDatabaseCredential extends Configuration {}

export interface IBMDatabaseQuery extends CloudDatabase<MangoQuery> {
    partitionKey?: string;
}

export function validateStorage(credential: IBMStorageCredential) {
    return !!(credential.apiKeyId && credential.serviceInstanceId && (credential.region || credential.endpoint));
}

export function validateDatabase(credential: IBMDatabaseCredential, data: CloudDatabase) {
    return !!((credential.account && credential.password || credential.url) && data.table);
}

export function setStorageCredential(credential: IBMStorageCredential) {
    credential.endpoint ||= `https://s3.${credential.region!}.cloud-object-storage.appdomain.cloud`;
    credential.region ||= /([^.]+)\.cloud-object-storage\.appdomain\.cloud$/.exec(credential.endpoint)?.[1];
    credential.ibmAuthEndpoint = 'https://iam.cloud.ibm.com/identity/token';
    credential.signatureVersion = 'iam';
}

export function createDatabaseClient(this: IModule, credential: IBMDatabaseCredential) {
    try {
        const Cloudant = require('@cloudant/cloudant');
        return new Cloudant(credential) as ServerScope;
    }
    catch (err) {
        this.writeFail(['Install IBM Cloudant?', 'npm i @cloudant/cloudant']);
        throw err;
    }
}

export async function createBucket(this: IModule, credential: IBMStorageCredential, bucket: string, publicRead?: boolean) {
    return createBucket_s3.call(this, credential as PlainObject, bucket, publicRead, 'ibm', 'ibm-cos-sdk/clients/s3');
}

export async function deleteObjects(this: IModule, credential: IBMStorageCredential, bucket: string, service = 'ibm') {
    setStorageCredential(credential);
    return deleteObjects_s3.call(this, credential as PlainObject, bucket, service, 'ibm-cos-sdk/clients/s3');
}

export async function executeQuery(this: ICloud, credential: IBMDatabaseCredential, data: IBMDatabaseQuery, cacheKey?: string) {
    try {
        const { table, id, query, partitionKey = '', limit = 0 } = data;
        let result: Undef<unknown[]>,
            queryString = table + partitionKey;
        const getScope = () => createDatabaseClient.call(this, { ...credential }).db.use(table!);
        const getCache = () => this.getDatabaseResult(data.service, credential, queryString, cacheKey);
        if (id) {
            queryString += id;
            if (result = getCache()) {
                return result;
            }
            const item = await getScope().get((partitionKey ? partitionKey + ':' : '') + id);
            result = [item];
        }
        else if (query && typeof query === 'object') {
            queryString += JSON.stringify(query) + limit;
            if (result = getCache()) {
                return result;
            }
            if (limit > 0) {
                query.limit = limit;
            }
            result = (partitionKey ? await getScope().partitionedFind(partitionKey, query) : await getScope().find(query)).docs;
        }
        if (result) {
            this.setDatabaseResult(data.service, credential, queryString, result, cacheKey);
            return result;
        }
    }
    catch (err) {
        this.writeFail(['Unable to execute DB query', data.service], err);
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