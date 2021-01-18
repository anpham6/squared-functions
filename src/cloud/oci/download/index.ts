import type { IModule } from '../../../types/lib';

import type { DownloadCallback, DownloadHost } from '../../index';

import { OCIStorageCredential, setStorageCredential } from '../index';

export default function download(this: IModule, credential: OCIStorageCredential, service = 'oci'): DownloadCallback {
    setStorageCredential(credential);
    return (require('../../aws/download') as DownloadHost).call(this, credential, service);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}