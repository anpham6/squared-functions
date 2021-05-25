import type { ICloud, IModule } from '../../types/lib';
import type { CloudDatabase, CloudService } from '../../types/lib/cloud';

import type { Acl } from '@google-cloud/storage/build/src/acl';
import type { Settings } from '@google-cloud/firestore';
import type { PathType } from '@google-cloud/datastore/build/src';
import type { entity } from '@google-cloud/datastore/build/src/entity';

import type * as gcs from '@google-cloud/storage';
import type * as gcf from '@google-cloud/firestore';
import type * as gcd from '@google-cloud/datastore';
import type * as gcb from '@google-cloud/bigquery';

import path = require('path');

type DatastoreKey = entity.KeyOptions | PathType[] | string;

function getPackageName(value: string) {
    switch (value.substring(value.indexOf('/') + 1)) {
        case 'bigquery':
            return 'BigQuery';
        case 'datastore':
            return 'Datastore';
        default:
            return 'Firestore';
    }
}

export interface GCloudStorageCredential extends Settings {
    location?: string;
    storageClass?: "STANDARD" | "NEARLINE" | "COLDLINE" | "ARCHIVE";
}

export interface GCloudDatabaseCredential extends Settings {}

export interface GCloudCloudBucket extends CloudService {}

export interface GCloudDatabaseQuery extends CloudDatabase<[string, string, unknown][]> {
    keys?: DatastoreKey | DatastoreKey[];
    orderBy?: [string, string][];
}

export function validateStorage(credential: GCloudStorageCredential) {
    return !!(credential.keyFile || credential.keyFilename);
}

export function validateDatabase(credential: GCloudDatabaseCredential, data: GCloudDatabaseQuery) {
    return validateStorage(credential) && (!!data.table || typeof data.query === 'string' || data.keys);
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
    let packageName = '@google-cloud/firestore';
    try {
        credential.projectId = getProjectId(credential);
        if (data) {
            if (typeof data.query === 'string') {
                const { BigQuery } = require(packageName = '@google-cloud/bigquery') as typeof gcb;
                return new BigQuery(credential);
            }
            else if (data.keys) {
                const { Datastore } = require(packageName = '@google-cloud/datastore') as typeof gcd;
                return new Datastore(credential);
            }
        }
        const { Firestore } = require(packageName) as typeof gcf;
        return new Firestore(credential);
    }
    catch (err) {
        this.writeFail([`Install Google Cloud ${getPackageName(packageName)} ?`, 'npm i ' + packageName]);
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
            this.formatMessage(this.logType.CLOUD, service, 'Bucket created', bucket, { titleColor: 'blue' });
            if (publicRead) {
                response.makePublic().then(() => setPublicRead.call(this, response.acl.default, bucket, true));
            }
        }
    }
    catch (err) {
        if (err.code !== 409) {
            this.formatFail(this.logType.CLOUD, service, ['Unable to create bucket', bucket], err);
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
            .then(() => this.formatMessage(this.logType.CLOUD, service, 'Bucket emptied', bucket, { titleColor: 'blue' }));
    }
    catch (err) {
        this.formatMessage(this.logType.CLOUD, service, ['Unable to empty bucket', bucket], err, { titleColor: 'yellow' });
    }
}

export async function executeQuery(this: ICloud, credential: GCloudDatabaseCredential, data: GCloudDatabaseQuery, cacheKey?: string) {
    try {
        const { table, id, query, orderBy, keys, limit = 0 } = data;
        let result: Undef<unknown[]>,
            queryString = '';
        const getClient = () => createDatabaseClient.call(this, { ...credential }, data);
        const getCache = () => this.getDatabaseResult(data.service, credential, queryString, cacheKey);
        if (typeof query === 'string') {
            queryString = query + (data.params ? JSON.stringify(data.params) : '') + (data.options ? JSON.stringify(data.options) : '') + limit;
            if (result = getCache()) {
                return result;
            }
            const options: gcb.Query = { ...data.options, query };
            options.params ||= data.params;
            if (limit > 0) {
                options.maxResults = limit;
            }
            const [job] = await (getClient() as gcb.BigQuery).createQueryJob(options);
            [result] = await job.getQueryResults();
        }
        else if (keys) {
            queryString = JSON.stringify(keys) + (data.options ? JSON.stringify(data.options) : '') + limit;
            if (result = getCache()) {
                return result;
            }
            const client = getClient() as gcd.Datastore;
            const items = !Array.isArray(keys) ? client.key(keys as string) : keys.map((item: string) => client.key(item));
            result = await client.get(items, data.options);
            if (result.length > limit) {
                result = result.slice(0, limit);
            }
        }
        else {
            queryString = table!;
            if (id) {
                queryString += id;
                if (result = getCache()) {
                    return result;
                }
                const item = await (getClient() as gcf.Firestore).collection(table!).doc(id).get();
                result = [item.data()];
            }
            else if (Array.isArray(query)) {
                queryString += JSON.stringify(query) + (orderBy ? JSON.stringify(orderBy) : '') + limit;
                if (result = getCache()) {
                    return result;
                }
                let collection = (getClient() as gcf.Firestore).collection(table!) as gcf.Query<gcf.DocumentData>;
                for (const where of query) {
                    if (where.length === 3) {
                        collection = collection.where(where[0], where[1] as gcf.WhereFilterOp, where[2]);
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

export function setPublicRead(this: IModule, acl: Acl, filename: string, requested?: boolean) {
    acl.add({ entity: 'allUsers', role: 'READER' })
        .then(() => {
            this.formatMessage(this.logType.CLOUD, 'gcloud', 'Grant public-read', filename, { titleColor: 'blue' });
        })
        .catch(err => {
            if (requested) {
                this.formatMessage(this.logType.CLOUD, 'gcloud', ['Unable to grant public-read', filename], err, { titleColor: 'yellow' });
            }
        });
}

export function getProjectId(credential: Settings) {
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