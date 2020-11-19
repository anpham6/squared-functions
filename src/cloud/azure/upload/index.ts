import type * as azure from '@azure/storage-blob';

import type { AzureCloudCredentials } from '../index';

import path = require('path');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;

type CloudUploadOptions = functions.internal.Cloud.CloudUploadOptions<AzureCloudCredentials>;
type CloudUploadCallback = functions.internal.Cloud.CloudUploadCallback;

const BUCKET_MAP: ObjectMap<boolean> = {};

function uploadAzure(this: IFileManager, credentials: AzureCloudCredentials, serviceName: string): CloudUploadCallback {
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
    return async (buffer: Buffer, options: CloudUploadOptions, success: (value?: unknown) => void) => {
        const container = credentials.container || uuid.v4();
        const containerClient = blobServiceClient.getContainerClient(container);
        const fileUri = options.fileUri;
        if (!BUCKET_MAP[container]) {
            try {
                if (!await containerClient.exists()) {
                    const { active, publicAccess } = options.upload;
                    await containerClient.create({ access: publicAccess || active && publicAccess !== false ? 'blob' : 'container' });
                    this.writeMessage('Container created', container, serviceName, 'blue');
                }
            }
            catch (err) {
                if (err.code !== 'ContainerAlreadyExists') {
                    this.writeFail(`${serviceName}: Unable to create container`, err);
                    success('');
                    return;
                }
            }
            BUCKET_MAP[container] = true;
        }
        let filename = options.filename;
        if (!filename) {
            filename = path.basename(fileUri);
            let exists = false;
            try {
                for await (const blob of containerClient.listBlobsFlat({ includeUncommitedBlobs: true })) {
                    if (blob.name === filename) {
                        exists = true;
                        break;
                    }
                }
            }
            catch {
                exists = true;
            }
            if (exists) {
                this.writeMessage(`File renamed [${filename}]`, filename = uuid.v4() + path.extname(fileUri), serviceName, 'yellow');
            }
        }
        containerClient.getBlockBlobClient(filename).upload(buffer, buffer.byteLength, { blobHTTPHeaders: { blobContentType: options.mimeType } })
            .then(() => {
                const apiEndpoint = options.upload.apiEndpoint;
                const url = (apiEndpoint ? apiEndpoint.replace(/\/*$/, '') : `https://${credentials.accountName}.blob.core.windows.net/${container}`) + '/' + filename;
                this.writeMessage('Upload success', url, serviceName);
                success(url);
            })
            .catch(err => {
                this.writeFail(`${serviceName}: Upload failed (${fileUri})`, err);
                success('');
            });
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadAzure;
    module.exports.default = uploadAzure;
    module.exports.__esModule = true;
}

export default uploadAzure;