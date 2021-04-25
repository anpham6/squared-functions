import type { IModule } from '../../../types/lib';
import type { DownloadData } from '../../../types/lib/cloud';
import type { DownloadCallback } from '../../index';

import Module from '../../../module';

import { AzureStorageCredential, createStorageClient } from '../index';

export default function download(this: IModule, credential: AzureStorageCredential, service = 'azure'): DownloadCallback {
    const blobServiceClient = createStorageClient.call(this, credential);
    return async (data: DownloadData, success: (value: Null<Buffer>) => void) => {
        const { bucket: Bucket, download: Download } = data;
        const Key = Download && Download.filename;
        if (Bucket && Key) {
            try {
                const location = Module.joinPath(Bucket, Key);
                const blobClient = blobServiceClient.getContainerClient(Bucket);
                blobClient.getBlockBlobClient(Key).downloadToBuffer()
                    .then(buffer => {
                        this.formatMessage(this.logType.CLOUD, service, 'Download success', location);
                        success(buffer);
                        if (Download.deleteObject) {
                            blobClient.delete()
                                .then(() => this.formatMessage(this.logType.CLOUD, service, 'Delete success', location, { titleColor: 'grey' }))
                                .catch(err => {
                                    if (err.code !== 'BlobNotFound') {
                                        this.formatFail(this.logType.CLOUD, service, ['Delete failed', location], err);
                                    }
                                });
                        }
                    })
                    .catch(err => {
                        this.formatFail(this.logType.CLOUD, service, ['Download failed', location], err);
                        success(null);
                    });
            }
            catch (err) {
                this.formatFail(this.logType.CLOUD, service, 'Unknown', err);
                success(null);
            }
        }
        else {
            const writeFail = (prop: string) => this.formatFail(this.logType.CLOUD, service, prop + ' not specified', new Error(service + ` -> ${prop.toLowerCase()} (Missing property)`));
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