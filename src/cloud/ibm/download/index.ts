import type { IModule } from '../../../types/lib';

import type { DownloadCallback, DownloadHost } from '../../index';

import { IBMStorageCredential, setStorageCredential } from '../index';

export default function download(this: IModule, credential: IBMStorageCredential, service = 'ibm'): DownloadCallback {
    setStorageCredential(credential);
    return (require('../../aws/download') as DownloadHost).call(this, credential, service, 'ibm-cos-sdk/clients/s3');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}