import type * as azure from '@azure/storage-blob';

import type { AzureCloudCredential } from '../index';

type IFileManager = functions.IFileManager;
type CloudServiceDownload = functions.squared.CloudServiceDownload;
type DownloadHost = functions.internal.Cloud.DownloadHost;

async function download(this: IFileManager, service: string, credential: AzureCloudCredential, data: CloudServiceDownload, success: (value: Null<Buffer>) => void) {
    const container = credential.container;
    if (container) {
        try {
            const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
            const sharedKeyCredential = new StorageSharedKeyCredential(credential.accountName, credential.accountKey) as azure.StorageSharedKeyCredential;
            const blobServiceClient = new BlobServiceClient(`https://${credential.accountName}.blob.core.windows.net`, sharedKeyCredential) as azure.BlobServiceClient;
            const blobClient = blobServiceClient.getContainerClient(container).getBlockBlobClient(data.filename);
            const location = container + '/' + data.filename;
            blobClient.downloadToBuffer()
                .then(buffer => {
                    this.writeMessage('Download success', location, service);
                    success(buffer);
                    if (data.deleteStorage) {
                        blobClient.delete()
                            .then(() => this.writeMessage('Delete success', location, service, 'grey'))
                            .catch(err => {
                                if (err.code !== 'BlobNotFound') {
                                    this.writeMessage(`Delete failed [${location}]`, err, service, 'red');
                                }
                            });
                    }
                })
                .catch(err => {
                    this.writeMessage(`Download failed [${location}]`, err, service, 'red');
                    success(null);
                });
        }
        catch (err) {
            this.writeFail(`Install ${service} SDK? [npm i @azure/storage-blob]`);
            throw err;
        }
    }
    else {
        this.writeMessage('Container not specified', data.filename, service, 'red');
        success(null);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default download as DownloadHost;