import type { IBMStorageCredential } from '../index';

import { setStorageCredential } from '../index';

type IFileManager = functions.IFileManager;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadCallback = functions.internal.Cloud.DownloadCallback;

function download(this: IFileManager, credential: IBMStorageCredential, service = 'IBM'): DownloadCallback {
    setStorageCredential.call(this, credential);
    return (require('../../aws/download') as DownloadHost).call(this, credential, service, 'ibm-cos-sdk/clients/s3');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default download as DownloadHost;