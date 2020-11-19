import type * as azure from '@azure/storage-blob';

import type { AzureCloudCredentials } from '../index';

import uuid = require('uuid');

type IFileManager = functions.IFileManager;
type CloudUploadOptions = functions.external.CloudUploadOptions<AzureCloudCredentials>;

function uploadHandlerAzure(this: IFileManager, credentials: AzureCloudCredentials, serviceName: string) {
    let blobServiceClient: azure.BlobServiceClient;
    try {
        const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
        const sharedKeyCredential = new StorageSharedKeyCredential(credentials.accountName, credentials.accountKey) as azure.StorageSharedKeyCredential;
        blobServiceClient = new BlobServiceClient(`https://${credentials.accountName}.blob.core.windows.net`, sharedKeyCredential) as azure.BlobServiceClient;
    }
    catch (err) {
        this.writeFail('Install SDK? [npm i @azure/storage-blob]', serviceName);
        throw err;
    }
    return async (buffer: Buffer, success: (value?: unknown) => void, options: CloudUploadOptions) => {
        let container = credentials.container,
            containerClient: azure.ContainerClient;
        if (!container) {
            containerClient = blobServiceClient.getContainerClient(container = uuid.v4());
            try {
                const { active, publicAccess } = options.config;
                await containerClient.create({ access: publicAccess || active && publicAccess !== false ? 'blob' : 'container' });
                this.writeMessage('Container created', container, serviceName, 'blue');
            }
            catch (err) {
                this.writeFail(`${serviceName}: Unable to create container`, err);
                success('');
                return;
            }
        }
        else {
            containerClient = blobServiceClient.getContainerClient(container);
        }
        containerClient.getBlockBlobClient(options.filename)
            .upload(buffer, buffer.byteLength, { blobHTTPHeaders: { blobContentType: options.mimeType } })
                .then(() => {
                    const apiEndpoint = options.config.apiEndpoint;
                    const url = (apiEndpoint ? apiEndpoint.replace(/\/*$/, '') : `https://${credentials.accountName}.blob.core.windows.net/${container!}`) + '/' + options.filename;
                    this.writeMessage('Upload', url, serviceName);
                    success(url);
                })
                .catch(err => {
                    this.writeFail(`${serviceName}: Upload failed (${options.fileUri})`, err);
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