import type * as azure from '@azure/storage-blob';

type IFileManager = functions.IFileManager;
type ICloud = functions.ICloud;

export interface AzureCloudCredential extends functions.external.Cloud.StorageSharedKeyCredential {}

export default function validate(credential: AzureCloudCredential) {
    return !!(credential.accountName && credential.accountKey || credential.connectionString || credential.sharedAccessSignature);
}

export async function deleteObjects(this: ICloud, credential: AzureCloudCredential, service: string, bucket: string) {
    try {
        const containerClient = createClient.call(this, credential, service).getContainerClient(bucket);
        const tasks: Promise<azure.BlobDeleteResponse>[] = [];
        let fileCount = 0;
        for await (const blob of containerClient.listBlobsFlat({ includeUncommitedBlobs: true })) {
            tasks.push(
                containerClient.deleteBlob(blob.name, { versionId: blob.versionId })
                    .catch(err => {
                        this.formatMessage(service, ['Unable to delete blob', bucket], err, 'yellow');
                        --fileCount;
                        return err;
                    })
            );
        }
        fileCount = tasks.length;
        return Promise.all(tasks).then(() => this.formatMessage(service, ['Container emptied', fileCount + ' files'], bucket, 'blue'));
    }
    catch (err) {
        this.formatMessage(service, ['Unable to empty container', bucket], err, 'yellow');
    }
}

export function createClient(this: ICloud | IFileManager, credential: AzureCloudCredential, service: string): azure.BlobServiceClient {
    try {
        const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
        const { connectionString, sharedAccessSignature } = credential;
        if (connectionString) {
            credential.accountName ||= /AccountName=([^;]+);/.exec(connectionString)?.[1];
            return BlobServiceClient.fromConnectionString(connectionString);
        }
        if (sharedAccessSignature) {
            credential.accountName ||= /^https:\/\/([a-z\d]+)\./.exec(sharedAccessSignature)?.[1];
            return new BlobServiceClient(sharedAccessSignature);
        }
        const sharedKeyCredential = new StorageSharedKeyCredential(credential.accountName, credential.accountKey) as azure.StorageSharedKeyCredential;
        return new BlobServiceClient(`https://${credential.accountName!}.blob.core.windows.net`, sharedKeyCredential);
    }
    catch (err) {
        this.writeFail([`Install ${service} SDK?`, 'npm i @azure/storage-blob']);
        throw err;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate, createClient, deleteObjects };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}