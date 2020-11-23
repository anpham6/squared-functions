import type { ConfigurationOptions } from 'ibm-cos-sdk/lib/config';

type IFileManager = functions.IFileManager;

export interface IBMCloudCredential extends ConfigurationOptions {
    endpoint?: string;
}

export interface IBMCloudBucket extends functions.squared.CloudService {
    bucket: string;
}

export function setCredential(this: IFileManager, credential: IBMCloudCredential) {
    credential.endpoint ||= 'https://s3.us-east.cloud-object-storage.appdomain.cloud';
    credential.region ||= /^[^.]+\.([a-z]+-[a-z]+)/.exec(credential.endpoint)?.[1] || 'us-east';
    credential.ibmAuthEndpoint = 'https://iam.cloud.ibm.com/identity/token';
    credential.signatureVersion = 'iam';
}

export default function validate(credential: IBMCloudCredential) {
    return !!(credential.apiKeyId && credential.serviceInstanceId);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate, setCredential };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}