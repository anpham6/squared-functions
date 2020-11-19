import type * as aws from 'aws-sdk/lib/core';

export interface OCICloudCredentials extends aws.ConfigurationOptions, PlainObject {
    region: string;
    namespace: string;
    bucket: string;
    endpoint?: string;
}

const validateOCI = (config: OCICloudCredentials) => !!(config.region && config.namespace && (config.accessKeyId || config.secretAccessKey));

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateOCI;
    module.exports.default = validateOCI;
    module.exports.__esModule = true;
}

export default validateOCI;