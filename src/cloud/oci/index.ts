import type { ConfigurationOptions } from 'aws-sdk/lib/core';

type IFileManager = functions.IFileManager;

export interface OCICloudCredential extends ConfigurationOptions {
    region: string;
    namespace: string;
    endpoint?: string;
}

export interface OCICloudBucket extends functions.squared.CloudService {
    bucket: string;
}

export function setCredential(this: IFileManager, credential: OCICloudCredential) {
    credential.endpoint = `https://${credential.namespace}.compat.objectstorage.${credential.region}.oraclecloud.com`;
    credential.s3ForcePathStyle = true;
    credential.signatureVersion = 'v4';
}

export default function validate(credential: OCICloudCredential) {
    return !!(credential.region && credential.namespace && credential.accessKeyId && credential.secretAccessKey);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate, setCredential };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}