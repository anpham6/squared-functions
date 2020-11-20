import type * as aws from 'aws-sdk/lib/core';

export interface S3CloudCredential extends aws.ConfigurationOptions {
    bucket?: string;
    endpoint?: string;
}

const validateS3 = (config: S3CloudCredential) => !!(config.accessKeyId && config.secretAccessKey);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateS3;
    module.exports.default = validateS3;
    module.exports.__esModule = true;
}

export default validateS3;