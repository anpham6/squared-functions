import type { ConfigurationOptions } from 'ibm-cos-sdk/lib/config';

import { deleteObjects as deleteObjects_s3 } from '../s3';

type IFileManager = functions.IFileManager;
type ICloud = functions.ICloud;

export interface IBMStorageCredential extends ConfigurationOptions {
    endpoint?: string;
}

export function validateStorage(credential: IBMStorageCredential) {
    return !!(credential.apiKeyId && credential.serviceInstanceId);
}

export function setStorageCredential(this: ICloud | IFileManager, credential: IBMStorageCredential) {
    credential.region ||= 'us-east';
    credential.endpoint ||= `https://s3.${credential.region}.cloud-object-storage.appdomain.cloud`;
    credential.ibmAuthEndpoint = 'https://iam.cloud.ibm.com/identity/token';
    credential.signatureVersion = 'iam';
}

export async function deleteObjects(this: ICloud, credential: IBMStorageCredential, bucket: string, service = 'IBM') {
    setStorageCredential.call(this, credential);
    return deleteObjects_s3.call(this, credential as PlainObject, bucket, service, 'ibm-cos-sdk/clients/s3');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateStorage, setStorageCredential, deleteObjects };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}