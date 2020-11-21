import type * as aws from 'aws-sdk/lib/core';

type IFileManager = functions.IFileManager;

export interface OCICloudCredential extends aws.ConfigurationOptions, PlainObject {
    region: string;
    namespace: string;
    bucket: string;
    endpoint?: string;
}

export function setCredential(this: IFileManager, credential: OCICloudCredential) {
    credential.endpoint = `https://${credential.namespace}.compat.objectstorage.${credential.region}.oraclecloud.com`;
    credential.s3ForcePathStyle = true;
    credential.signatureVersion = 'v4';
}

export default function validate(config: OCICloudCredential) {
    return !!(config.region && config.namespace && config.accessKeyId && config.secretAccessKey);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate, setCredential };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}