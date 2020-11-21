import type { GoogleAuthOptions } from 'google-auth-library';

export interface GCSCloudCredential extends GoogleAuthOptions {
    bucket?: string;
    location?: string;
    storageClass?: "STANDARD" | "NEARLINE" | "COLDLINE" | "ARCHIVE";
}

const validate = (config: GCSCloudCredential) => !!(config.keyFile || config.keyFilename);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default validate;