import type { GoogleAuthOptions } from 'google-auth-library';
import type { Acl } from '@google-cloud/storage/build/src/acl';
import type * as gcs from '@google-cloud/storage';

type IFileManager = functions.IFileManager;
type ICloud = functions.ICloud;

export interface GCSStorageCredential extends GoogleAuthOptions {
    location?: string;
    storageClass?: "STANDARD" | "NEARLINE" | "COLDLINE" | "ARCHIVE";
}

export interface GCSCloudBucket extends functions.squared.CloudService {
    bucket?: string;
}

export function validateStorage(credential: GCSStorageCredential) {
    return !!(credential.keyFile || credential.keyFilename);
}

export function createStorageClient(this: ICloud | IFileManager, credential: GCSStorageCredential) {
    try {
        const { Storage } = require('@google-cloud/storage');
        return new Storage(credential) as gcs.Storage;
    }
    catch (err) {
        this.writeFail([`Install Google Cloud Storage`, 'npm i @google-cloud/storage']);
        throw err;
    }
}

export async function deleteObjects(this: ICloud, credential: GCSStorageCredential, bucket: string, service = 'GCS') {
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

export function setPublicRead(this: IFileManager, acl: Acl, filename: string, requested?: boolean) {
    acl.add({ entity: 'allUsers', role: 'READER' })
        .then(() => {
            this.formatMessage('GCS', 'Grant public-read', filename, 'blue');
        })
        .catch(err => {
            if (requested) {
                this.formatMessage('GCS', ['Unable to grant public-read', filename], err, 'yellow');
            }
        });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateStorage, createStorageClient, deleteObjects, setPublicRead };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}