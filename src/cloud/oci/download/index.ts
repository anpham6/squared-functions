import type { Internal } from '../../../types/lib';
import type { OCIStorageCredential } from '../index';

import { setStorageCredential } from '../index';

type InstanceHost = Internal.Cloud.InstanceHost;
type DownloadHost = Internal.Cloud.DownloadHost;
type DownloadCallback = Internal.Cloud.DownloadCallback;

export default function download(this: InstanceHost, credential: OCIStorageCredential, service = 'oci'): DownloadCallback {
    setStorageCredential(credential);
    return (require('../../aws/download') as DownloadHost).call(this, credential, service);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}