import type { GoogleAuthOptions } from 'google-auth-library';

export interface GCSCloudService extends functions.squared.CloudService, GoogleAuthOptions {
    bucket: string;
}

const validateGCS = (data: GCSCloudService, settings: GoogleAuthOptions) => !!(data.bucket && (data.keyFile || settings.keyFilename));

if (typeof module !== 'undefined' && module.exports) {
    module.exports = validateGCS;
    module.exports.default = validateGCS;
    module.exports.__esModule = true;
}

export default validateGCS;