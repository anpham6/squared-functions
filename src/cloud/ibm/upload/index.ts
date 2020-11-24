import type { IBMCloudCredential } from '../index';

import { setCredential } from '../index';

type IFileManager = functions.IFileManager;
type UploadHost = functions.internal.Cloud.UploadHost;

function upload(this: IFileManager, service: string, credential: IBMCloudCredential) {
    setCredential.call(this, credential);
    return (require('../../s3/upload') as UploadHost).call(this, service, credential, 'ibm-cos-sdk/clients/s3');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = upload;
    module.exports.default = upload;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default upload as UploadHost;