import type { GoogleAuthOptions } from 'google-auth-library';
import type { Acl } from '@google-cloud/storage/build/src/acl';
import type * as gcs from '@google-cloud/storage';
import type * as gcf from '@google-cloud/firestore';

import path = require('path');

type IFileManager = functions.IFileManager;
type ICloud = functions.ICloud;
type CloudDatabase = functions.squared.CloudDatabase;

const CACHE_DB: ObjectMap<any[]> = {};

export interface GCloudStorageCredential extends GoogleAuthOptions {
    location?: string;
    storageClass?: "STANDARD" | "NEARLINE" | "COLDLINE" | "ARCHIVE";
}

export interface GCloudDatabaseCredential extends GoogleAuthOptions {}

export interface GCloudCloudBucket extends functions.squared.CloudService {}

export interface GCloudDatabaseQuery extends functions.squared.CloudDatabase {
    where: unknown[][];
    orderBy: unknown[][];
}

export function validateStorage(credential: GCloudStorageCredential) {
    return !!(credential.keyFile || credential.keyFilename);
}

export function validateDatabase(credential: GCloudDatabaseCredential, data: CloudDatabase) {
    return validateStorage(credential) && !!data.table;
}

export function createStorageClient(this: ICloud | IFileManager, credential: GCloudStorageCredential) {
    try {
        const { Storage } = require('@google-cloud/storage');
        return new Storage(credential) as gcs.Storage;
    }
    catch (err) {
        this.writeFail([`Install Google Cloud Storage`, 'npm i @google-cloud/storage']);
        throw err;
    }
}

export function createDatabaseClient(this: ICloud | IFileManager, credential: GCloudDatabaseCredential) {
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

export async function deleteObjects(this: ICloud, credential: GCloudStorageCredential, bucket: string, service = 'gcloud') {
    try {
        return createStorageClient.call(this, credential)
            .bucket(bucket)
            .deleteFiles({ force: true })
            .then(() => this.formatMessage(service, 'Bucket emptied', bucket, 'blue'));
    }
    catch (err) {
        this.formatMessage(service, ['Unable to empty bucket', bucket], err, 'yellow');
    }
}

export async function execDatabaseQuery(this: ICloud | IFileManager, credential: GCloudDatabaseCredential, data: GCloudDatabaseQuery, cacheKey?: string) {
    const client = createDatabaseClient.call(this, credential);
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
            const item = await client.collection(data.table).doc(data.id).get();
            result = [item.data()];
        }
        else if (data.where) {
            const { where, orderBy, limit = 0 } = data;
            if (cacheKey) {
                cacheKey += JSON.stringify(where).replace(/\s+/g, '');
                if (orderBy) {
                    cacheKey += JSON.stringify(orderBy).replace(/\s+/g, '');
                }
                cacheKey += limit;
                if (CACHE_DB[cacheKey]) {
                    return CACHE_DB[cacheKey];
                }
            }
            let collection = client.collection(data.table) as gcf.Query<gcf.DocumentData>;
            for (const query of where) {
                if (query.length === 3) {
                    collection = collection.where(query[0] as string, query[1] as gcf.WhereFilterOp, query[2] as any);
                }
            }
            for (const query of orderBy) {
                if (query.length) {
                    collection = collection.orderBy(query[0] as string, query[1] === 'desc' || query[1] === 'asc' ? query[1] : undefined);
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

export function setPublicRead(this: IFileManager, acl: Acl, filename: string, requested?: boolean) {
    acl.add({ entity: 'allUsers', role: 'READER' })
        .then(() => {
            this.formatMessage('GCloud', 'Grant public-read', filename, 'blue');
        })
        .catch(err => {
            if (requested) {
                this.formatMessage('GCloud', ['Unable to grant public-read', filename], err, 'yellow');
            }
        });
}

export function getProjectId(credential: GoogleAuthOptions) {
    return require(path.resolve(credential.keyFilename || credential.keyFile!)).project_id || '';
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateStorage, createStorageClient, deleteObjects, validateDatabase, createDatabaseClient, execDatabaseQuery, setPublicRead, getProjectId };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}