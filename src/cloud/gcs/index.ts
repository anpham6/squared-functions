import type { GoogleAuthOptions } from 'google-auth-library';

export interface GCSCloudService extends functions.squared.CloudService, GoogleAuthOptions {
    bucket: string;
}

const validateGCS = (config: GCSCloudService) => !!(config.bucket && (config.keyFile || config.keyFilename));

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateGCS;
    module.exports.default = validateGCS;
    module.exports.__esModule = true;
}

export default validateGCS;