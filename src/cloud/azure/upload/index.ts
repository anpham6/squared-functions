import type * as azure from '@azure/storage-blob';

import type { AzureCloudCredential } from '../index';

import path = require('path');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;
type UploadData = functions.internal.Cloud.UploadData<AzureCloudCredential>;
type UploadHost = functions.internal.Cloud.UploadHost;
type UploadCallback = functions.internal.Cloud.UploadCallback;

const BUCKET_MAP: ObjectMap<boolean> = {};

function uploadAzure(this: IFileManager, service: string, credential: AzureCloudCredential): UploadCallback {
    let blobServiceClient: azure.BlobServiceClient;
    try {
        const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
        const sharedKeyCredential = new StorageSharedKeyCredential(credential.accountName, credential.accountKey) as azure.StorageSharedKeyCredential;
        blobServiceClient = new BlobServiceClient(`https://${credential.accountName}.blob.core.windows.net`, sharedKeyCredential) as azure.BlobServiceClient;
    }
    catch (err) {
        this.writeFail(`Install ${service} SDK? [npm i @azure/storage-blob]`);
        throw err;
    }
    return async (data: UploadData, success: (value: string) => void) => {
        if (!credential.container) {
            data.storage.container = data.bucketGroup;
            credential.container = data.bucketGroup;
        }
        const container = credential.container;
        const fileUri = data.fileUri;
        const containerClient = blobServiceClient.getContainerClient(container);
        if (!BUCKET_MAP[container]) {
            try {
                if (!await containerClient.exists()) {
                    const { active, publicAccess } = data.upload;
                    await containerClient.create({ access: publicAccess || active && publicAccess !== false ? 'blob' : 'container' });
                    this.writeMessage('Container created', container, service, 'blue');
                }
            }
            catch (err) {
                if (err.code !== 'ContainerAlreadyExists') {
                    this.writeMessage(`Unable to create container [${container}]`, err, service, 'red');
                    success('');
                    return;
                }
            }
            BUCKET_MAP[container] = true;
        }
        let filename = data.filename;
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
                this.writeMessage(`File renamed [${filename}]`, filename = uuid.v4() + path.extname(fileUri), service, 'yellow');
            }
        }
        const Key = [filename];
        const Body = [data.buffer];
        const ContentType = [data.mimeType];
        const apiEndpoint = data.upload.apiEndpoint;
        for (const item of data.fileGroup) {
            Body.push(item[0] as Buffer);
            Key.push(filename + item[1]);
        }
        for (let i = 0; i < Key.length; ++i) {
            containerClient.getBlockBlobClient(Key[i])
                .upload(Body[i], Body[i].byteLength, { blobHTTPHeaders: { blobContentType: ContentType[i] } })
                .then(() => {
                    const url = (apiEndpoint ? this.toPosix(apiEndpoint) : `https://${credential.accountName}.blob.core.windows.net/${container}`) + '/' + Key[i];
                    this.writeMessage('Upload success', url, service);
                    if (i === 0) {
                        success(url);
                    }
                })
                .catch(err => {
                    if (i === 0) {
                        this.writeMessage(`Upload failed [${Key[i]}]`, err, service, 'red');
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

export default uploadAzure as UploadHost;