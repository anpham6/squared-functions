import type * as aws from 'aws-sdk/lib/core';

export interface OCICloudCredential extends aws.ConfigurationOptions, PlainObject {
    region: string;
    namespace: string;
    bucket: string;
    endpoint?: string;
}

export function setCredential(credential: OCICloudCredential) {
    credential.endpoint = `https://${credential.namespace}.compat.objectstorage.${credential.region}.oraclecloud.com`;
    credential.s3ForcePathStyle = true;
    credential.signatureVersion = 'v4';
}

const validate = (config: OCICloudCredential) => !!(config.region && config.namespace && config.accessKeyId && config.secretAccessKey);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate, setCredential };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default validate;