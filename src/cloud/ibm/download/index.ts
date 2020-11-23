import type { IBMCloudBucket, IBMCloudCredential } from '../index';

import { setCredential } from '../index';

type IFileManager = functions.IFileManager;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadData = functions.internal.Cloud.DownloadData<IBMCloudCredential, IBMCloudBucket>;

async function download(this: IFileManager, service: string, credential: IBMCloudCredential, data: DownloadData, success: (value?: unknown) => void) {
    setCredential.call(this, credential);
    return (require('../../s3/download') as DownloadHost).call(this, service, credential, data, success, 'ibm-cos-sdk/clients/s3');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default download as DownloadHost;