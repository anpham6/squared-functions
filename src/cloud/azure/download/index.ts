import type { AzureStorageCredential } from '../index';

import { createStorageClient } from '../index';

type IFileManager = functions.IFileManager;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadData = functions.internal.Cloud.DownloadData;
type DownloadCallback = functions.internal.Cloud.DownloadCallback;

function download(this: IFileManager, credential: AzureStorageCredential, service = 'azure'): DownloadCallback {
    const blobServiceClient = createStorageClient.call(this, credential);
    return async (data: DownloadData, success: (value: Null<Buffer>) => void) => {
        const { bucket: Bucket, download: Download } = data.storage;
        if (Bucket && Download && Download.filename) {
            try {
                const location = Bucket + '/' + Download.filename;
                const blobClient = blobServiceClient.getContainerClient(Bucket);
                blobClient.getBlockBlobClient(Download.filename)
                    .downloadToBuffer()
                    .then(buffer => {
                        this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Download success', location);
                        success(buffer);
                        if (Download.deleteObject) {
                            blobClient.delete()
                                .then(() => this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Delete success', location, 'grey'))
                                .catch(err => {
                                    if (err.code !== 'BlobNotFound') {
                                        this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Delete failed', location], err, 'red');
                                    }
                                });
                        }
                    })
                    .catch(err => {
                        this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Download failed', location], err, 'red');
                        success(null);
                    });
            }
            catch {
                success(null);
            }
        }
        else {
            this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Container not specified', Download && Download.filename, 'red');
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