import type { ICloud, IModule } from '../../types/lib';
import type { CloudDatabase } from '../../types/lib/cloud';

import type * as storage from '@azure/storage-blob';
import type * as db from '@azure/cosmos';

export interface AzureStorageCredential {
    accountName?: string;
    accountKey?: string;
    connectionString?: string;
    sharedAccessSignature?: string;
}

export interface AzureDatabaseCredential extends db.CosmosClientOptions {}

export interface AzureDatabaseQuery extends CloudDatabase<string> {
    partitionKey?: string;
    storedProcedureId?: string;
}

export function validateStorage(credential: AzureStorageCredential) {
    return !!(credential.accountName && credential.accountKey || credential.connectionString || credential.sharedAccessSignature);
}

export function validateDatabase(credential: AzureDatabaseCredential, data: CloudDatabase) {
    return !!(credential.endpoint && credential.key && data.name && data.table);
}

export function createStorageClient(this: IModule, credential: AzureStorageCredential): storage.BlobServiceClient {
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
        const sharedKeyCredential = new StorageSharedKeyCredential(credential.accountName, credential.accountKey) as storage.StorageSharedKeyCredential;
        return new BlobServiceClient(`https://${credential.accountName!}.blob.core.windows.net`, sharedKeyCredential);
    }
    catch (err) {
        this.writeFail(['Install Azure Storage Blob?', 'npm i @azure/storage-blob']);
        throw err;
    }
}

export function createDatabaseClient(this: IModule, credential: AzureDatabaseCredential): db.CosmosClient {
    try {
        const { CosmosClient } = require('@azure/cosmos');
        return new CosmosClient(credential);
    }
    catch (err) {
        this.writeFail(['Install Azure Cosmos DB?', 'npm i @azure/cosmos']);
        throw err;
    }
}

export async function createBucket(this: IModule, credential: AzureStorageCredential, bucket: string, publicRead?: boolean, service = 'azure') {
    const blobServiceClient = createStorageClient.call(this, credential);
    try {
        const containerClient = blobServiceClient.getContainerClient(bucket);
        if (!await containerClient.exists()) {
            const response = await containerClient.create({ access: publicRead ? 'blob' : 'container' });
            if (response.errorCode) {
                this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Container created with errors', 'Error code: ' + response.errorCode], bucket, { titleColor: 'yellow' });
            }
            else {
                this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Container created', bucket, { titleColor: 'blue' });
            }
        }
    }
    catch (err) {
        if (err.code !== 'ContainerAlreadyExists') {
            this.formatFail(this.logType.CLOUD_STORAGE, service, ['Unable to create container', bucket], err);
            return false;
        }
    }
    return true;
}

export async function deleteObjects(this: IModule, credential: AzureStorageCredential, bucket: string, service = 'azure') {
    const blobServiceClient = createStorageClient.call(this, credential);
    try {
        const containerClient = blobServiceClient.getContainerClient(bucket);
        const tasks: Promise<storage.BlobDeleteResponse>[] = [];
        let fileCount = 0;
        for await (const blob of containerClient.listBlobsFlat({ includeUncommitedBlobs: true })) {
            tasks.push(
                containerClient.deleteBlob(blob.name, { versionId: blob.versionId })
                    .catch(err => {
                        this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Unable to delete blob', bucket], err, { titleColor: 'yellow' });
                        --fileCount;
                        return err;
                    })
            );
        }
        fileCount = tasks.length;
        return Promise.all(tasks).then(() => this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Container emptied', fileCount + ' files'], bucket, { titleColor: 'blue' }));
    }
    catch (err) {
        this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Unable to empty container', bucket], err, { titleColor: 'yellow' });
    }
}

export async function executeQuery(this: ICloud, credential: AzureDatabaseCredential, data: AzureDatabaseQuery, cacheKey?: string) {
    const client = createDatabaseClient.call(this, credential);
    let result: Undef<any[]>,
        queryString = '';
    try {
        const { name, table, id, query, storedProcedureId, params, partitionKey = '', limit = 0 } = data;
        if (table && name) {
            const container = client.database(name).container(table);
            queryString = name + table + partitionKey + (data.options ? JSON.stringify(data.options) : '');
            if (storedProcedureId && params) {
                queryString += storedProcedureId + JSON.stringify(params);
                result = this.getDatabaseResult(data.service, credential, queryString, cacheKey);
                if (result) {
                    return result;
                }
                const item = await container.scripts.storedProcedure(storedProcedureId).execute(partitionKey, params, data.options);
                if (item.statusCode === 200) {
                    result = Array.isArray(item.resource) ? item.resource : [item.resource];
                }
            }
            else if (id) {
                queryString += id;
                result = this.getDatabaseResult(data.service, credential, queryString, cacheKey);
                if (result) {
                    return result;
                }
                const item = await container.item(id.toString(), partitionKey).read(data.options);
                if (item.statusCode === 200) {
                    result = [item.resource];
                }
            }
            else if (typeof query === 'string') {
                queryString += query + limit;
                result = this.getDatabaseResult(data.service, credential, queryString, cacheKey);
                if (result) {
                    return result;
                }
                if (limit > 0) {
                    (data.options ||= {}).maxItemCount = limit;
                }
                result = (await container.items.query(query, data.options).fetchAll()).resources;
            }
        }
    }
    catch (err) {
        this.writeFail(['Unable to execute DB query', data.service], err);
    }
    if (result) {
        this.setDatabaseResult(data.service, credential, queryString, result, cacheKey);
        return result;
    }
    return [];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateStorage,
        createStorageClient,
        validateDatabase,
        createDatabaseClient,
        createBucket,
        deleteObjects,
        executeQuery
    };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}