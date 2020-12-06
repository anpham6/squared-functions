import type { IBMStorageCredential } from '../index';

import { setStorageCredential } from '../index';

type InstanceHost = functions.internal.Cloud.InstanceHost;
type UploadHost = functions.internal.Cloud.UploadHost;

function upload(this: InstanceHost, credential: IBMStorageCredential, service = 'ibm') {
    setStorageCredential.call(this, credential);
    return (require('../../aws/upload') as UploadHost).call(this, credential, service, 'ibm-cos-sdk/clients/s3');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = upload;
    module.exports.default = upload;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default upload as UploadHost;