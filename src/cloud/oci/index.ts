import type { ConfigurationOptions } from 'aws-sdk/lib/core';

import { deleteObjects as deleteObjects_s3 } from '../s3';

type IFileManager = functions.IFileManager;
type ICloud = functions.ICloud;

export interface OCIStorageCredential extends ConfigurationOptions {
    region: string;
    namespace: string;
    endpoint?: string;
}

export function validateStorage(credential: OCIStorageCredential) {
    return !!(credential.region && credential.namespace && credential.accessKeyId && credential.secretAccessKey);
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateStorage, setStorageCredential, deleteObjects };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}