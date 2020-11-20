import type { GoogleAuthOptions } from 'google-auth-library';

export interface GCSCloudCredential extends GoogleAuthOptions {
    bucket?: string;
    location?: string;
    storageClass?: "STANDARD" | "NEARLINE" | "COLDLINE" | "ARCHIVE";
}

const validateGCS = (config: GCSCloudCredential) => !!(config.keyFile || config.keyFilename);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateGCS;
    module.exports.default = validateGCS;
    module.exports.__esModule = true;
}

export default validateGCS;