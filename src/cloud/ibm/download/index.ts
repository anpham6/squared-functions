import type { Internal } from '../../../types/lib';
import type { IBMStorageCredential } from '../index';

import { setStorageCredential } from '../index';

type InstanceHost = Internal.Cloud.InstanceHost;
type DownloadHost = Internal.Cloud.DownloadHost;
type DownloadCallback = Internal.Cloud.DownloadCallback;

export default function download(this: InstanceHost, credential: IBMStorageCredential, service = 'ibm'): DownloadCallback {
    setStorageCredential(credential);
    return (require('../../aws/download') as DownloadHost).call(this, credential, service, 'ibm-cos-sdk/clients/s3');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}