import type { GoogleAuthOptions } from 'google-auth-library';
import type { Acl } from '@google-cloud/storage/build/src/acl';
import type * as gcs from '@google-cloud/storage';
import type * as gcf from '@google-cloud/firestore';

import path = require('path');

type CloudDatabase = functions.squared.CloudDatabase;
type InstanceHost = functions.internal.Cloud.InstanceHost;

const CACHE_DB: ObjectMap<any[]> = {};

export interface GCloudStorageCredential extends GoogleAuthOptions {
    location?: string;
    storageClass?: "STANDARD" | "NEARLINE" | "COLDLINE" | "ARCHIVE";
}

export interface GCloudDatabaseCredential extends GoogleAuthOptions {}

export interface GCloudCloudBucket extends functions.squared.CloudService {}

export interface GCloudDatabaseQuery extends functions.squared.CloudDatabase<[string, string, unknown][]> {
    orderBy?: [string, string][];
}

export function validateStorage(credential: GCloudStorageCredential) {
    return !!(credential.keyFile || credential.keyFilename);
}

export function validateDatabase(credential: GCloudDatabaseCredential, data: CloudDatabase) {
    return validateStorage(credential) && !!data.table;
}

export function createStorageClient(this: InstanceHost, credential: GCloudStorageCredential) {
    try {
        const { Storage } = require('@google-cloud/storage');
        return new Storage(credential) as gcs.Storage;
    }
    catch (err) {
        this.writeFail([`Install Google Cloud Storage`, 'npm i @google-cloud/storage']);
        throw err;
    }
}

export function createDatabaseClient(this: InstanceHost, credential: GCloudDatabaseCredential) {
    try {
        const Firestore = require('@google-cloud/firestore');
        credential.projectId = getProjectId(credential);
        return new Firestore(credential) as gcf.Firestore;
    }
    catch (err) {
        this.writeFail([`Install Google Cloud Firestore`, 'npm i @google-cloud/firestore']);
        throw err;
    }
}

export async function createBucket(this: InstanceHost, credential: GCloudStorageCredential, bucket: string, publicRead?: boolean, service = 'gcloud') {
    const storage = createStorageClient.call(this, credential);
    try {
        const [exists] = await storage.bucket(bucket).exists();
        if (!exists) {
            storage.projectId = getProjectId(credential);
            const [response] = await storage.createBucket(bucket, credential);
            this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Bucket created', bucket, 'blue');
            if (publicRead) {
                response.makePublic().then(() => setPublicRead.call(this, response.acl.default, bucket, true));
            }
        }
    }
    catch (err) {
        if (err.code !== 409) {
            this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Unable to create bucket', bucket], err, 'red');
            return false;
        }
    }
    return true;
}

export async function deleteObjects(this: InstanceHost, credential: GCloudStorageCredential, bucket: string, service = 'gcloud') {
    try {
        return createStorageClient.call(this, credential)
            .bucket(bucket)
            .deleteFiles({ force: true })
            .then(() => this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Bucket emptied', bucket, 'blue'));
    }
    catch (err) {
        this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Unable to empty bucket', bucket], err, 'yellow');
    }
}

export async function executeQuery(this: InstanceHost, credential: GCloudDatabaseCredential, data: GCloudDatabaseQuery, cacheKey?: string) {
    const client = createDatabaseClient.call(this, credential);
    let result: Undef<any[]>;
    try {
        const { table, id, query, orderBy, limit = 0 } = data;
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
            const item = await client.collection(table).doc(id).get();
            result = [item.data()];
        }
        else if (Array.isArray(query)) {
            if (cacheKey) {
                cacheKey += JSON.stringify(query).replace(/\s+/g, '');
                if (orderBy) {
                    cacheKey += JSON.stringify(orderBy).replace(/\s+/g, '');
                }
                cacheKey += limit;
                if (CACHE_DB[cacheKey]) {
                    return CACHE_DB[cacheKey];
                }
            }
            let collection = client.collection(table) as gcf.Query<gcf.DocumentData>;
            for (const where of query) {
                if (query.length === 3) {
                    collection = collection.where(where[0], where[1] as gcf.WhereFilterOp, where[2] as any);
                }
            }
            if (orderBy) {
                for (const order of orderBy) {
                    if (query.length) {
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

export function setPublicRead(this: InstanceHost, acl: Acl, filename: string, requested?: boolean) {
    acl.add({ entity: 'allUsers', role: 'READER' })
        .then(() => {
            this.formatMessage(this.logType.CLOUD_STORAGE, 'gcloud', 'Grant public-read', filename, 'blue');
        })
        .catch(err => {
            if (requested) {
                this.formatMessage(this.logType.CLOUD_STORAGE, 'gcloud', ['Unable to grant public-read', filename], err, 'yellow');
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