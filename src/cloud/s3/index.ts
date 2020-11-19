import type * as awsCore from 'aws-sdk/lib/core';

export interface S3CloudCredentials extends awsCore.ConfigurationOptions {
    bucket?: string;
    endpoint?: string;
}

const validateS3 = (config: S3CloudCredentials) => !!(config.accessKeyId || config.secretAccessKey);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateS3;
    module.exports.default = validateS3;
    module.exports.__esModule = true;
}

export default validateS3;