import type { CloudDatabase, CloudService } from '../../types/lib/squared';

import type { ICloud, IModule } from '../../types/lib';

import type { GoogleAuthOptions } from 'google-auth-library';
import type { Acl } from '@google-cloud/storage/build/src/acl';

import type * as gcs from '@google-cloud/storage';
import type * as gcf from '@google-cloud/firestore';
import type * as gcb from '@google-cloud/bigquery';

import path = require('path');

export interface GCloudStorageCredential extends GoogleAuthOptions {
    location?: string;
    storageClass?: "STANDARD" | "NEARLINE" | "COLDLINE" | "ARCHIVE";
}

export interface GCloudDatabaseCredential extends GoogleAuthOptions {}

export interface GCloudCloudBucket extends CloudService {}

export interface GCloudDatabaseQuery extends CloudDatabase<[string, string, unknown][]> {
    orderBy?: [string, string][];
}

export function validateStorage(credential: GCloudStorageCredential) {
    return !!(credential.keyFile || credential.keyFilename);
}

export function validateDatabase(credential: GCloudDatabaseCredential, data: GCloudDatabaseQuery) {
    return validateStorage(credential) && (!!data.table || typeof data.query === 'string');
}

export function createStorageClient(this: IModule, credential: GCloudStorageCredential) {
    try {
        const { Storage } = require('@google-cloud/storage');
        return new Storage(credential) as gcs.Storage;
    }
    catch (err) {
        this.writeFail(['Install Google Cloud Storage?', 'npm i @google-cloud/storage']);
        throw err;
    }
}

export function createDatabaseClient(this: IModule, credential: GCloudDatabaseCredential, data?: GCloudDatabaseQuery) {
    try {
        credential.projectId = getProjectId(credential);
        if (data && typeof data.query === 'string') {
            const { BigQuery } = require('@google-cloud/bigquery');
            return new BigQuery(credential) as gcb.BigQuery;
        }
        const Firestore = require('@google-cloud/firestore');
        return new Firestore(credential) as gcf.Firestore;
    }
    catch (err) {
        this.writeFail(['Install Google Cloud Firestore?', 'npm i @google-cloud/firestore']);
        throw err;
    }
}

export async function createBucket(this: IModule, credential: GCloudStorageCredential, bucket: string, publicRead?: boolean, service = 'gcloud') {
    const storage = createStorageClient.call(this, credential);
    try {
        const [exists] = await storage.bucket(bucket).exists();
        if (!exists) {
            storage.projectId = getProjectId(credential);
            const [response] = await storage.createBucket(bucket, credential);
            this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Bucket created', bucket, { titleColor: 'blue' });
            if (publicRead) {
                response.makePublic().then(() => setPublicRead.call(this, response.acl.default, bucket, true));
            }
        }
    }
    catch (err) {
        if (err.code !== 409) {
            this.formatFail(this.logType.CLOUD_STORAGE, service, ['Unable to create bucket', bucket], err);
            return false;
        }
    }
    return true;
}

export async function deleteObjects(this: IModule, credential: GCloudStorageCredential, bucket: string, service = 'gcloud') {
    const storage = createStorageClient.call(this, credential);
    try {
        return storage.bucket(bucket)
            .deleteFiles({ force: true })
            .then(() => this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Bucket emptied', bucket, { titleColor: 'blue' }));
    }
    catch (err) {
        this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Unable to empty bucket', bucket], err, { titleColor: 'yellow' });
    }
}

export async function executeQuery(this: ICloud, credential: GCloudDatabaseCredential, data: GCloudDatabaseQuery, cacheKey?: string) {
    const client = createDatabaseClient.call(this, credential, data);
    let result: Undef<any[]>,
        queryString = '';
    try {
        const { table, id, query, orderBy, limit = 0 } = data;
        if (typeof query === 'string') {
            queryString = query + (data.params ? JSON.stringify(data.params) : '') + (data.options ? JSON.stringify(data.options) : '') + limit;
            const options: gcb.Query = { ...data.options, query };
            options.params ||= data.params;
            if (limit > 0) {
                options.maxResults = limit;
            }
            const [job] = await (client as gcb.BigQuery).createQueryJob(options);
            [result] = await job.getQueryResults();
        }
        else if (table) {
            queryString = table;
            if (id) {
                queryString += id;
                result = this.getDatabaseResult(data.service, credential, queryString, cacheKey);
                if (result) {
                    return result;
                }
                const item = await (client as gcf.Firestore).collection(table).doc(id).get();
                result = [item.data()];
            }
            else if (Array.isArray(query)) {
                queryString += JSON.stringify(query) + (orderBy ? JSON.stringify(orderBy) : '') + limit;
                result = this.getDatabaseResult(data.service, credential, queryString, cacheKey);
                if (result) {
                    return result;
                }
                let collection = (client as gcf.Firestore).collection(table) as gcf.Query<gcf.DocumentData>;
                for (const where of query) {
                    if (where.length === 3) {
                        collection = collection.where(where[0], where[1] as gcf.WhereFilterOp, where[2] as any);
                    }
                }
                if (orderBy) {
                    for (const order of orderBy) {
                        if (order.length) {
                            collection = collection.orderBy(order[0], order[1] === 'desc' || order[1] === 'asc' ? order[1] : undefined);
                        }
                    }
                }
                if (limit > 0) {
                    collection = collection.limit(limit);
                }
                result = (await collection.get()).docs.map(item => item.data());
            }
        }
    }
    catch (err) {
        this.writeFail(['Unable to execute DB query', data.service], err);
    }
    if (result) {
        this.setDatabaseResult(data.service, credential, queryString, result, cacheKey);
        return result;
    }
    return [];
}

export function setPublicRead(this: IModule, acl: Acl, filename: string, requested?: boolean) {
    acl.add({ entity: 'allUsers', role: 'READER' })
        .then(() => {
            this.formatMessage(this.logType.CLOUD_STORAGE, 'gcloud', 'Grant public-read', filename, { titleColor: 'blue' });
        })
        .catch(err => {
            if (requested) {
                this.formatMessage(this.logType.CLOUD_STORAGE, 'gcloud', ['Unable to grant public-read', filename], err, { titleColor: 'yellow' });
            }
        });
}

export function getProjectId(credential: GoogleAuthOptions) {
    return require(path.resolve(credential.keyFilename || credential.keyFile!)).project_id || '';
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateStorage,
        createStorageClient,
        validateDatabase,
        createDatabaseClient,
        createBucket,
        deleteObjects,
        executeQuery,
        getProjectId,
        setPublicRead
    };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}