import type { OCICloudCredential } from '../index';

type IFileManager = functions.IFileManager;

type DownloadHost = functions.internal.Cloud.DownloadHost;

async function downloadOCI(this: IFileManager, service: string, credential: OCICloudCredential, filename: string, success: (value?: unknown) => void) {
    credential.endpoint = `https://${credential.namespace}.compat.objectstorage.${credential.region}.oraclecloud.com`;
    credential.s3ForcePathStyle = true;
    credential.signatureVersion = 'v4';
    return (require('../../s3/download') as DownloadHost).call(this, service, credential, filename, success);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = downloadOCI;
    module.exports.default = downloadOCI;
    module.exports.__esModule = true;
}

export default downloadOCI as DownloadHost;