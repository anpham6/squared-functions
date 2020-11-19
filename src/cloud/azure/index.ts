export interface AzureCloudCredentials extends functions.external.Cloud.StorageSharedKeyCredential {
    container?: string;
}

const validateAzure = (config: AzureCloudCredentials) => !!(config.accountName || config.accountKey);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateAzure;
    module.exports.default = validateAzure;
    module.exports.__esModule = true;
}

export default validateAzure;