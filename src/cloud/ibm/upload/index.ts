import type { IBMStorageCredential } from '../index';

import { setStorageCredential } from '../index';

type IFileManager = functions.IFileManager;
type UploadHost = functions.internal.Cloud.UploadHost;

function upload(this: IFileManager, credential: IBMStorageCredential, service = 'IBM') {
    setStorageCredential.call(this, credential);
    return (require('../../aws/upload') as UploadHost).call(this, credential, service, 'ibm-cos-sdk/clients/s3');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = upload;
    module.exports.default = upload;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default upload as UploadHost;