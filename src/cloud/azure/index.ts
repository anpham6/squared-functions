export interface AzureCloudCredential extends functions.external.Cloud.StorageSharedKeyCredential, PlainObject {
    container?: string;
}

export default function validate(config: AzureCloudCredential) {
    return !!(config.accountName && config.accountKey);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}