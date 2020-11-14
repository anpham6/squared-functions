import type * as awsCore from 'aws-sdk/lib/core';

type CloudService = functions.chrome.CloudService;

export interface S3CloudService extends CloudService, awsCore.ConfigurationOptions {
    bucket: string;
}

const validateS3 = (data: S3CloudService, settings: awsCore.ConfigurationOptions) => !!(data.bucket && ((data.accessKeyId || settings.accessKeyId) && (data.secretAccessKey || settings.secretAccessKey)));

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateS3;
    module.exports.default = validateS3;
    module.exports.__esModule = true;
}

export default validateS3;