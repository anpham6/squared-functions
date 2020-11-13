import type * as awsCore from 'aws-sdk/lib/core';

type CloudService = functions.chrome.CloudService;

const validateS3 = (data: CloudService, settings: awsCore.ConfigurationOptions) => !!(data.bucket && ((data.accessKeyId || settings.accessKeyId) && (data.secretAccessKey || settings.secretAccessKey)));

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateS3;
    module.exports.default = validateS3;
    module.exports.__esModule = true;
}

export default validateS3;