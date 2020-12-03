import type { OCIStorageCredential } from '../index';

import { setStorageCredential } from '../index';

type IFileManager = functions.IFileManager;
type UploadHost = functions.internal.Cloud.UploadHost;

function upload(this: IFileManager, credential: OCIStorageCredential, service = 'OCI') {
    setStorageCredential.call(this, credential);
    return (require('../../aws/upload') as UploadHost).call(this, credential, service);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = upload;
    module.exports.default = upload;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default upload as UploadHost;