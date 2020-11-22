import type { GoogleAuthOptions } from 'google-auth-library';
import type { Acl } from '@google-cloud/storage/build/src/acl';

type IFileManager = functions.IFileManager;

export interface GCSCloudCredential extends GoogleAuthOptions {
    bucket?: string;
    location?: string;
    storageClass?: "STANDARD" | "NEARLINE" | "COLDLINE" | "ARCHIVE";
}

export function setPublicRead(this: IFileManager, acl: Acl, objectName: string, requested?: boolean) {
    acl.add({ entity: 'allUsers', role: 'READER' })
        .then(() => {
            this.formatMessage('GCS', 'Grant public-read', objectName, 'blue');
        })
        .catch(err => {
            if (requested) {
                this.formatMessage('GCS', ['Unable to grant public-read', objectName], err, 'yellow');
            }
        });
}

export default function validate(config: GCSCloudCredential) {
    return !!(config.keyFile || config.keyFilename);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate, setPublicRead };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}