import type { ConfigurationOptions } from 'ibm-cos-sdk/lib/config';

import { deleteObjects as deleteObjects_s3 } from '../s3';

type IFileManager = functions.IFileManager;
type ICloud = functions.ICloud;

export interface IBMCloudCredential extends ConfigurationOptions {
    endpoint?: string;
}

export interface IBMCloudBucket extends functions.squared.CloudService {
    bucket: string;
}

export default function validate(credential: IBMCloudCredential) {
    return !!(credential.apiKeyId && credential.serviceInstanceId);
}

export function setCredential(this: IFileManager | ICloud, credential: IBMCloudCredential) {
    credential.endpoint ||= 'https://s3.us-east.cloud-object-storage.appdomain.cloud';
    credential.region ||= /^[^.]+\.([a-z]+-[a-z]+)/.exec(credential.endpoint)?.[1] || 'us-east';
    credential.ibmAuthEndpoint = 'https://iam.cloud.ibm.com/identity/token';
    credential.signatureVersion = 'iam';
}

export async function deleteObjects(this: ICloud, service: string, credential: IBMCloudCredential, bucket: string) {
    setCredential.call(this, credential);
    return deleteObjects_s3.call(this, service, credential as PlainObject, bucket, 'ibm-cos-sdk/clients/s3');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate, setCredential, deleteObjects };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}