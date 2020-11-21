import type * as aws from 'aws-sdk/lib/core';

export interface S3CloudCredential extends aws.ConfigurationOptions {
    bucket?: string;
    endpoint?: string;
}

const validate = (config: S3CloudCredential) => !!(config.accessKeyId && config.secretAccessKey);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default validate;