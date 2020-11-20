import type * as azure from '@azure/storage-blob';

import type { AzureCloudCredential } from '../index';

import path = require('path');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;

type UploadOptions = functions.internal.Cloud.UploadOptions<AzureCloudCredential>;
type UploadCallback = functions.internal.Cloud.UploadCallback;

const BUCKET_MAP: ObjectMap<boolean> = {};

function uploadAzure(this: IFileManager, credential: AzureCloudCredential, serviceName: string): UploadCallback {
    let blobServiceClient: azure.BlobServiceClient;
    try {
        const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
        const sharedKeyCredential = new StorageSharedKeyCredential(credential.accountName, credential.accountKey) as azure.StorageSharedKeyCredential;
        blobServiceClient = new BlobServiceClient(`https://${credential.accountName}.blob.core.windows.net`, sharedKeyCredential) as azure.BlobServiceClient;
    }
    catch (err) {
        this.writeFail('Install SDK? [npm i @azure/storage-blob]', serviceName);
        throw err;
    }
    return async (buffer: Buffer, options: UploadOptions, success: (value?: unknown) => void) => {
        const container = credential.container || uuid.v4();
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
        const Key = [filename];
        const Body = [buffer];
        const ContentType = [options.mimeType];
        const apiEndpoint = options.upload.apiEndpoint;
        for (const item of options.fileGroup) {
            Body.push(item[0] as Buffer);
            Key.push(filename + item[1]);
        }
        for (let i = 0; i < Key.length; ++i) {
            containerClient.getBlockBlobClient(Key[i]).upload(Body[i], Body[i].byteLength, { blobHTTPHeaders: { blobContentType: ContentType[i] } })
                .then(() => {
                    const url = (apiEndpoint ? apiEndpoint.replace(/\/+$/, '') : `https://${credential.accountName}.blob.core.windows.net/${container}`) + '/' + Key[i];
                    this.writeMessage('Upload success', url, serviceName);
                    if (i === 0) {
                        success(url);
                    }
                })
                .catch(err => {
                    if (i === 0) {
                        this.writeFail(`${serviceName}: Upload failed (${fileUri})`, err);
                        success('');
                    }
                });
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadAzure;
    module.exports.default = uploadAzure;
    module.exports.__esModule = true;
}

export default uploadAzure;