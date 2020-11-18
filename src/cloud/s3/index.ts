import type * as awsCore from 'aws-sdk/lib/core';

export interface S3CloudService extends functions.squared.CloudService, awsCore.ConfigurationOptions {
    bucket: string;
}

const validateS3 = (config: S3CloudService) => !!(config.bucket && (config.accessKeyId || config.secretAccessKey));

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateS3;
    module.exports.default = validateS3;
    module.exports.__esModule = true;
}

export default validateS3;