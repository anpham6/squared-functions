export interface AzureCloudCredential extends functions.external.Cloud.StorageSharedKeyCredential, PlainObject {}

export interface AzureCloudBucket extends functions.squared.CloudService {
    container?: string;
}

export default function validate(credential: AzureCloudCredential) {
    return !!(credential.accountName && credential.accountKey);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}