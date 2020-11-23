import type * as azure from '@azure/storage-blob';

import type { AzureCloudBucket, AzureCloudCredential } from '../index';

type IFileManager = functions.IFileManager;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadData = functions.internal.Cloud.DownloadData<AzureCloudCredential, AzureCloudBucket>;

async function download(this: IFileManager, service: string, credential: AzureCloudCredential, data: DownloadData, success: (value: Null<Buffer>) => void) {
    const container = data.service.container;
    if (container) {
        try {
            const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
            const sharedKeyCredential = new StorageSharedKeyCredential(credential.accountName, credential.accountKey) as azure.StorageSharedKeyCredential;
            const blobServiceClient = new BlobServiceClient(`https://${credential.accountName}.blob.core.windows.net`, sharedKeyCredential) as azure.BlobServiceClient;
            const blobClient = blobServiceClient.getContainerClient(container).getBlockBlobClient(data.download.filename);
            const location = container + '/' + data.download.filename;
            blobClient.downloadToBuffer()
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
        catch (err) {
            this.writeFail([`Install ${service} SDK?`, 'npm i @azure/storage-blob']);
            throw err;
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