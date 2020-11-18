type StorageSharedKeyCredential = functions.external.StorageSharedKeyCredential;

export interface AzureCloudService extends functions.squared.CloudService, StorageSharedKeyCredential {
    container: string;
}

const validateAzure = (config: AzureCloudService) => !!(config.container && (config.accountName || config.accountKey));

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateAzure;
    module.exports.default = validateAzure;
    module.exports.__esModule = true;
}

export default validateAzure;