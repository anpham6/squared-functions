export interface AzureCloudCredential extends functions.external.Cloud.StorageSharedKeyCredential, PlainObject {
    container?: string;
}

const validateAzure = (config: AzureCloudCredential) => !!(config.accountName && config.accountKey);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateAzure;
    module.exports.default = validateAzure;
    module.exports.__esModule = true;
}

export default validateAzure;