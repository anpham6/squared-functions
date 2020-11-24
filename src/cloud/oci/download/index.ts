import type { OCICloudCredential } from '../index';

import { setCredential } from '../index';

type IFileManager = functions.IFileManager;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadData = functions.internal.Cloud.DownloadData<OCICloudCredential>;

async function download(this: IFileManager, service: string, credential: OCICloudCredential, data: DownloadData, success: (value?: unknown) => void) {
    setCredential.call(this, credential);
    return (require('../../s3/download') as DownloadHost).call(this, service, credential, data, success);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default download as DownloadHost;