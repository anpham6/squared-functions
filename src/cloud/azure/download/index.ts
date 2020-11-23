import type { AzureCloudBucket, AzureCloudCredential } from '../index';

import { createClient } from '../index';

type IFileManager = functions.IFileManager;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadData = functions.internal.Cloud.DownloadData<AzureCloudCredential, AzureCloudBucket>;

async function download(this: IFileManager, service: string, credential: AzureCloudCredential, data: DownloadData, success: (value: Null<Buffer>) => void) {
    const container = data.service.container;
    if (container) {
        try {
            const location = container + '/' + data.download.filename;
            const blobClient = createClient.call(this, service, credential).getContainerClient(container);
            blobClient.getBlockBlobClient(data.download.filename)
                .downloadToBuffer()
                .then(buffer => {
                    this.formatMessage(service, 'Download success', location);
                    success(buffer);
                    if (data.download.deleteStorage) {
                        blobClient.delete()
                            .then(() => this.formatMessage(service, 'Delete success', location, 'grey'))
                            .catch(err => {
                                if (err.code !== 'BlobNotFound') {
                                    this.formatMessage(service, ['Delete failed', location], err, 'red');
                                }
                            });
                    }
                })
                .catch(err => {
                    this.formatMessage(service, ['Download failed', location], err, 'red');
                    success(null);
                });
        }
        catch {
            success(null);
        }
    }
    else {
        this.formatMessage(service, 'Container not specified', data.download.filename, 'red');
        success(null);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default download as DownloadHost;