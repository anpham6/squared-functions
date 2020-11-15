type StorageSharedKeyCredential = functions.external.StorageSharedKeyCredential;

export interface AzureCloudService extends functions.squared.CloudService, StorageSharedKeyCredential {
    container: string;
}

const validateAzure = (service: AzureCloudService, settings: StorageSharedKeyCredential) => !!(service.container && (service.accountName || settings.accountName) && (service.accountKey || settings.accountKey));

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateAzure;
    module.exports.default = validateAzure;
    module.exports.__esModule = true;
}

export default validateAzure;