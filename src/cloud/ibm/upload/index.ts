import type { IModule, Internal } from '../../../types/lib';
import type { IBMStorageCredential } from '../index';

import { setStorageCredential } from '../index';

type UploadHost = Internal.Cloud.UploadHost;

export default function upload(this: IModule, credential: IBMStorageCredential, service = 'ibm') {
    setStorageCredential(credential);
    return (require('../../aws/upload') as UploadHost).call(this, credential, service, 'ibm-cos-sdk/clients/s3');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = upload;
    module.exports.default = upload;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}