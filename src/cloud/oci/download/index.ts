import type { internal } from '../../../types/lib';
import type { OCIStorageCredential } from '../index';

import { setStorageCredential } from '../index';

type InstanceHost = internal.Cloud.InstanceHost;
type DownloadHost = internal.Cloud.DownloadHost;
type DownloadCallback = internal.Cloud.DownloadCallback;

export default function download(this: InstanceHost, credential: OCIStorageCredential, service = 'oci'): DownloadCallback {
    setStorageCredential(credential);
    return (require('../../aws/download') as DownloadHost).call(this, credential, service);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}