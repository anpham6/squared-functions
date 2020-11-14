type CloudService = functions.chrome.CloudService;

export interface StorageSharedKeyCredential {
    accountName: string;
    accountKey: string;
}

export interface AzureCloudService extends CloudService, StorageSharedKeyCredential {
    container: string;
}

const validateAzure = (service: AzureCloudService, settings: StorageSharedKeyCredential) => !!(service.container && (service.accountName || settings.accountName) && (service.accountKey || settings.accountKey));

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateAzure;
    module.exports.default = validateAzure;
    module.exports.__esModule = true;
}

export default validateAzure;