import type * as azure from '@azure/storage-blob';

import type { AzureCloudCredential } from '../index';

type IFileManager = functions.IFileManager;
type CloudServiceDownload = functions.squared.CloudServiceDownload;
type DownloadHost = functions.internal.Cloud.DownloadHost;

async function downloadAzure(this: IFileManager, service: string, credential: AzureCloudCredential, download: CloudServiceDownload, success: (value: Null<Buffer>) => void) {
    const container = credential.container;
    if (container) {
        try {
            const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
            const sharedKeyCredential = new StorageSharedKeyCredential(credential.accountName, credential.accountKey) as azure.StorageSharedKeyCredential;
            const blobServiceClient = new BlobServiceClient(`https://${credential.accountName}.blob.core.windows.net`, sharedKeyCredential) as azure.BlobServiceClient;
            const blobClient = blobServiceClient.getContainerClient(container).getBlockBlobClient(download.filename);
            const location = container + '/' + download.filename;
            blobClient.downloadToBuffer()
                .then(buffer => {
                    this.writeMessage('Download success', location, service);
                    success(buffer);
                    if (download.deleteStorage) {
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
        this.writeMessage('Container not specified', download.filename, service, 'red');
        success(null);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = downloadAzure;
    module.exports.default = downloadAzure;
    module.exports.__esModule = true;
}

export default downloadAzure as DownloadHost;