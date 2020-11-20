import type * as azure from '@azure/storage-blob';

import type { AzureCloudCredential } from '../index';

type IFileManager = functions.IFileManager;

type DownloadHost = functions.internal.Cloud.DownloadHost;

async function downloadAzure(this: IFileManager, service: string, credential: AzureCloudCredential, blobName: string, success: (value: Null<Buffer>) => void) {
    const container = credential.container;
    if (container) {
        try {
            const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
            const location = container + ':' + blobName;
            const sharedKeyCredential = new StorageSharedKeyCredential(credential.accountName, credential.accountKey) as azure.StorageSharedKeyCredential;
            const blobServiceClient = new BlobServiceClient(`https://${credential.accountName}.blob.core.windows.net`, sharedKeyCredential) as azure.BlobServiceClient;
            blobServiceClient
                .getContainerClient(container)
                .getBlockBlobClient(blobName)
                .downloadToBuffer()
                .then(buffer => {
                    this.writeMessage('Download success', location, service);
                    success(buffer);
                })
                .catch(err => {
                    this.writeFail(`Download failed [${service}][${location}]`, err);
                    success(null);
                });
        }
        catch (err) {
            this.writeFail(`Install ${service} SDK? [npm i @azure/storage-blob]`);
            throw err;
        }
    }
    else {
        this.writeFail(`Container not specified [${service}][container:${blobName}]`);
        success(null);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = downloadAzure;
    module.exports.default = downloadAzure;
    module.exports.__esModule = true;
}

export default downloadAzure as DownloadHost;