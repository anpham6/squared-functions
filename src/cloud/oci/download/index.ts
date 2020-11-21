import type { OCICloudCredential } from '../index';

import { setCredential } from '../index';

type IFileManager = functions.IFileManager;
type CloudServiceDownload = functions.squared.CloudServiceDownload;
type DownloadHost = functions.internal.Cloud.DownloadHost;

async function downloadOCI(this: IFileManager, service: string, credential: OCICloudCredential, download: CloudServiceDownload, success: (value?: unknown) => void) {
    setCredential(credential);
    return (require('../../s3/download') as DownloadHost).call(this, service, credential, download, success);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = downloadOCI;
    module.exports.default = downloadOCI;
    module.exports.__esModule = true;
}

export default downloadOCI as DownloadHost;