import type { OCIStorageCredential } from '../index';

import { setStorageCredential } from '../index';

type InstanceHost = functions.internal.Cloud.InstanceHost;
type UploadHost = functions.internal.Cloud.UploadHost;

export default function upload(this: InstanceHost, credential: OCIStorageCredential, service = 'oci') {
    setStorageCredential(credential);
    return (require('../../aws/upload') as UploadHost).call(this, credential, service);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = upload;
    module.exports.default = upload;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}