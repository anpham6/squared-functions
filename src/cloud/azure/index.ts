export interface AzureCloudCredential extends functions.external.Cloud.StorageSharedKeyCredential, PlainObject {
    container?: string;
}

const validate = (config: AzureCloudCredential) => !!(config.accountName && config.accountKey);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default validate;