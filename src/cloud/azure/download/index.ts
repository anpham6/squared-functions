import type { AzureCloudCredential } from '../index';

import { createClient } from '../index';

type IFileManager = functions.IFileManager;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadData = functions.internal.Cloud.DownloadData;
type DownloadCallback = functions.internal.Cloud.DownloadCallback;

function download(this: IFileManager, credential: AzureCloudCredential, service: string): DownloadCallback {
    const blobServiceClient = createClient.call(this, credential, service);
    return async (data: DownloadData, success: (value: Null<Buffer>) => void) => {
        const bucket = data.service.bucket;
        if (bucket) {
            try {
                const location = bucket + '/' + data.download.filename;
                const blobClient = blobServiceClient.getContainerClient(bucket);
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
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default download as DownloadHost;