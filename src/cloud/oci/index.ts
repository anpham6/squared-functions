import type * as awsCore from 'aws-sdk/lib/core';

export interface OCICloudService extends functions.squared.CloudService, awsCore.ConfigurationOptions {
    region: string;
    namespace: string;
    bucket: string;
}

const validateOCI = (config: OCICloudService) => !!(config.region && config.namespace && (config.accessKeyId || config.secretAccessKey));

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateOCI;
    module.exports.default = validateOCI;
    module.exports.__esModule = true;
}

export default validateOCI;