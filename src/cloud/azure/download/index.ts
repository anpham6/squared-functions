import type { Internal } from '../../../types/lib';
import type { AzureStorageCredential } from '../index';

import Module from '../../../module';

import { createStorageClient } from '../index';

type InstanceHost = Internal.Cloud.InstanceHost;
type DownloadData = Internal.Cloud.DownloadData;
type DownloadCallback = Internal.Cloud.DownloadCallback;

export default function download(this: InstanceHost, credential: AzureStorageCredential, service = 'azure'): DownloadCallback {
    const blobServiceClient = createStorageClient.call(this, credential);
    return async (data: DownloadData, success: (value: Null<Buffer>) => void) => {
        const { bucket: Bucket, download: Download } = data;
        const Key = Download && Download.filename;
        if (Bucket && Key) {
            try {
                const location = Module.joinPosix(Bucket, Key);
                const blobClient = blobServiceClient.getContainerClient(Bucket);
                blobClient.getBlockBlobClient(Key).downloadToBuffer()
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
            catch (err) {
                this.formatFail(this.logType.CLOUD_STORAGE, service, 'Unknown', err);
                success(null);
            }
        }
        else {
            const writeFail = (prop: string) => this.formatFail(this.logType.CLOUD_STORAGE, service, prop + ' not specified', new Error(`Missing property <${service}:${prop.toLowerCase()}>`));
            if (!Bucket) {
                writeFail('Bucket');
            }
            if (!Key) {
                writeFail('Filename');
            }
            success(null);
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}