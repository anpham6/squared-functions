import type { GoogleAuthOptions } from 'google-auth-library';
import type { Acl } from '@google-cloud/storage/build/src/acl';
import type * as gcs from '@google-cloud/storage';

type IFileManager = functions.IFileManager;
type ICloud = functions.ICloud;

export interface GCSCloudCredential extends GoogleAuthOptions {
    location?: string;
    storageClass?: "STANDARD" | "NEARLINE" | "COLDLINE" | "ARCHIVE";
}

export interface GCSCloudBucket extends functions.squared.CloudService {
    bucket?: string;
}

export default function validate(credential: GCSCloudCredential) {
    return !!(credential.keyFile || credential.keyFilename);
}

export function createClient(this: ICloud | IFileManager, credential: GCSCloudCredential, service: string) {
    try {
        const { Storage } = require('@google-cloud/storage');
        return new Storage(credential) as gcs.Storage;
    }
    catch (err) {
        this.writeFail([`Install ${service} SDK?`, 'npm i @google-cloud/storage']);
        throw err;
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

export async function deleteObjects(this: ICloud, credential: GCSCloudCredential, service: string, bucket: string) {
    try {
        return createClient.call(this, credential, service)
            .bucket(bucket)
            .deleteFiles({ force: true })
            .then(() => this.formatMessage(service, 'Bucket emptied', bucket, 'blue'));
    }
    catch (err) {
        this.formatMessage(service, ['Unable to empty bucket', bucket], err, 'yellow');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate, createClient, setPublicRead, deleteObjects };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}