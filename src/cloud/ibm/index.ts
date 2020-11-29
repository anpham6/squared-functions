import type { ConfigurationOptions } from 'ibm-cos-sdk/lib/config';

import { deleteObjects as deleteObjects_s3 } from '../s3';

type IFileManager = functions.IFileManager;
type ICloud = functions.ICloud;

export interface IBMCloudCredential extends ConfigurationOptions {
    endpoint?: string;
}

export default function validate(credential: IBMCloudCredential) {
    return !!(credential.apiKeyId && credential.serviceInstanceId);
}

export function setCredential(this: ICloud | IFileManager, credential: IBMCloudCredential) {
    credential.region ||= 'us-east';
    credential.endpoint ||= `https://s3.${credential.region}.cloud-object-storage.appdomain.cloud`;
    credential.ibmAuthEndpoint = 'https://iam.cloud.ibm.com/identity/token';
    credential.signatureVersion = 'iam';
}

export async function deleteObjects(this: ICloud, credential: IBMCloudCredential, service: string, bucket: string) {
    setCredential.call(this, credential);
    return deleteObjects_s3.call(this, credential as PlainObject, service, bucket, 'ibm-cos-sdk/clients/s3');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate, setCredential, deleteObjects };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}