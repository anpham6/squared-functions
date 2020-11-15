import type { AzureCloudService } from '../index';
import type * as azure from '@azure/storage-blob';

type IFileManager = functions.IFileManager;

interface CloudUploadOptions extends functions.external.CloudUploadOptions {
    config: AzureCloudService;
}

function uploadHandlerAzure(this: IFileManager, config: AzureCloudService) {
    let container: azure.ContainerClient;
    try {
        const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
        const sharedKeyCredential = new StorageSharedKeyCredential(config.accountName, config.accountKey) as azure.StorageSharedKeyCredential;
        const blobServiceClient = new BlobServiceClient(`https://${config.accountName}.blob.core.windows.net`, sharedKeyCredential) as azure.BlobServiceClient;
        container = blobServiceClient.getContainerClient(config.container);
    }
    catch (err) {
        this.writeFail('Install SDK? [npm i @azure/storage-blob]', 'Azure');
        throw err;
    }
    return (buffer: Buffer, success: (value?: unknown) => void, options: CloudUploadOptions) => {
        const blob = container.getBlockBlobClient(options.filename);
        blob.upload(buffer, buffer.byteLength, { blobHTTPHeaders: { blobContentType: options.mimeType } })
            .then(() => {
                const url = (config.apiEndpoint ? config.apiEndpoint.replace(/\/*$/, '') : `https://${config.accountName}.blob.core.windows.net/${config.container}`) + '/' + options.filename;
                this.writeMessage('Upload', url, 'Azure');
                success(url);
            })
            .catch(err => {
                this.writeFail(`Azure: Upload failed (${options.fileUri})`, err);
                success('');
            });
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadHandlerAzure;
    module.exports.default = uploadHandlerAzure;
    module.exports.__esModule = true;
}

export default uploadHandlerAzure;