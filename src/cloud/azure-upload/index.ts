import type * as azure from '@azure/storage-blob';
import type { AzureCloudService } from '../azure-client';

type IFileManager = functions.IFileManager;

interface CloudUploadOptions extends functions.external.CloudUploadOptions {
    config: AzureCloudService;
}

const uploadHandlerAzure = (manager: IFileManager, config: AzureCloudService) => {
    let container: azure.ContainerClient;
    try {
        const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
        const sharedKeyCredential = new StorageSharedKeyCredential(config.accountName, config.accountKey) as azure.StorageSharedKeyCredential;
        const blobServiceClient = new BlobServiceClient(`https://${config.accountName}.blob.core.windows.net`, sharedKeyCredential) as azure.BlobServiceClient;
        container = blobServiceClient.getContainerClient(config.container);
    }
    catch (err) {
        manager.writeFail('Install SDK? [npm i @azure/storage-blob]', 'Azure');
        throw err;
    }
    return (buffer: Buffer, success: (value?: unknown) => void, options: CloudUploadOptions) => {
        const blob = container.getBlockBlobClient(options.filename);
        blob.upload(buffer, buffer.byteLength, { blobHTTPHeaders: { blobContentType: options.mimeType } })
            .then(() => {
                const url = (config.endpoint ? config.endpoint.replace(/\/*$/, '') : `https://${config.accountName}.blob.core.windows.net/${config.container}`) + '/' + options.filename;
                manager.writeMessage('Upload', url, 'Azure');
                success(url);
            })
            .catch(err => {
                manager.writeFail(`Azure: Upload failed (${options.fileUri})`, err);
                success('');
            });
    };
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadHandlerAzure;
    module.exports.default = uploadHandlerAzure;
    module.exports.__esModule = true;
}

export default uploadHandlerAzure;