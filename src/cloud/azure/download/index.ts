import type { AzureStorageCredential } from '../index';

import { createStorageClient } from '../index';

type InstanceHost = functions.internal.Cloud.InstanceHost;
type DownloadData = functions.internal.Cloud.DownloadData;
type DownloadCallback = functions.internal.Cloud.DownloadCallback;

export default function download(this: InstanceHost, credential: AzureStorageCredential, service = 'azure'): DownloadCallback {
    const blobServiceClient = createStorageClient.call(this, credential);
    return async (data: DownloadData, success: (value: Null<Buffer>) => void) => {
        const { bucket: Bucket, download: Download } = data;
        if (Bucket && Download && Download.filename) {
            try {
                const location = this.joinPosix(Bucket, Download.filename);
                const blobClient = blobServiceClient.getContainerClient(Bucket);
                blobClient.getBlockBlobClient(Download.filename).downloadToBuffer()
                    .then(buffer => {
                        this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Download success', location);
                        success(buffer);
                        if (Download.deleteObject) {
                            blobClient.delete()
                                .then(() => this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Delete success', location, { titleColor: 'grey' }))
                                .catch(err => {
                                    if (err.code !== 'BlobNotFound') {
                                        this.formatFail(this.logType.CLOUD_STORAGE, service, ['Delete failed', location], err);
                                    }
                                });
                        }
                    })
                    .catch(err => {
                        this.formatFail(this.logType.CLOUD_STORAGE, service, ['Download failed', location], err);
                        success(null);
                    });
            }
            catch {
                success(null);
            }
        }
        else {
            this.formatFail(this.logType.CLOUD_STORAGE, service, 'Container not specified', Download && Download.filename);
            success(null);
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}