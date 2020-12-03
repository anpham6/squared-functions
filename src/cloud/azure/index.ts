import type * as storage from '@azure/storage-blob';
import type * as db from '@azure/cosmos';

type IFileManager = functions.IFileManager;
type ICloud = functions.ICloud;
type CloudDatabase = functions.squared.CloudDatabase;

const CACHE_DB: ObjectMap<any[]> = {};

export interface AzureStorageCredential extends functions.external.Cloud.StorageSharedKeyCredential {}

export interface AzureDatabaseCredential extends db.CosmosClientOptions {}

export interface AzureDatabaseQuery extends functions.squared.CloudDatabase {
    partitionKey?: string;
}

export function validateStorage(credential: AzureStorageCredential) {
    return !!(credential.accountName && credential.accountKey || credential.connectionString || credential.sharedAccessSignature);
}

export function validateDatabase(credential: AzureDatabaseCredential, data: CloudDatabase) {
    return !!(credential.key && credential.endpoint && data.name && data.table);
}

export function createStorageClient(this: ICloud | IFileManager, credential: AzureStorageCredential): storage.BlobServiceClient {
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
        this.writeFail([`Install Azure Storage Blob?`, 'npm i @azure/storage-blob']);
        throw err;
    }
}

export function createDatabaseClient(this: ICloud | IFileManager, credential: AzureDatabaseCredential): db.CosmosClient {
    try {
        const { CosmosClient } = require('@azure/cosmos');
        return new CosmosClient(credential);
    }
    catch (err) {
        this.writeFail([`Install Azure Cosmos DB?`, 'npm i @azure/cosmos']);
        throw err;
    }
}

export async function deleteObjects(this: ICloud, credential: AzureStorageCredential, bucket: string, service = 'azure') {
    try {
        const containerClient = createStorageClient.call(this, credential).getContainerClient(bucket);
        const tasks: Promise<storage.BlobDeleteResponse>[] = [];
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

export async function executeQuery(this: ICloud | IFileManager, credential: AzureDatabaseCredential, data: AzureDatabaseQuery, cacheKey?: string) {
    const client = createDatabaseClient.call(this, credential);
    let result: Undef<any[]>;
    try {
        const { name, table, id, query, partitionKey = '', limit = 0 } = data;
        const container = client.database(name!).container(table);
        if (cacheKey) {
            cacheKey += name! + table + partitionKey;
        }
        if (id) {
            if (cacheKey) {
                cacheKey += id;
                if (CACHE_DB[cacheKey]) {
                    return CACHE_DB[cacheKey];
                }
            }
            const item = await container.item(id.toString(), partitionKey).read();
            if (item.statusCode === 200) {
                result = [item.resource];
            }
        }
        else if (typeof query === 'string') {
            if (cacheKey) {
                cacheKey += query.replace(/\s+/g, '') + limit;
                if (CACHE_DB[cacheKey]) {
                    return CACHE_DB[cacheKey];
                }
            }
            const options: db.FeedOptions = {};
            for (const attr in data) {
                switch (attr) {
                    case 'continuationToken':
                    case 'continuationTokenLimitInKB':
                    case 'enableScanInQuery':
                    case 'maxDegreeOfParallelism':
                    case 'maxItemCount':
                    case 'useIncrementalFeed':
                    case 'accessCondition':
                    case 'populateQueryMetrics':
                    case 'bufferItems':
                    case 'forceQueryPlan':
                    case 'partitionKey':
                        options[attr] = data[attr];
                        break;
                }
            }
            if (limit > 0) {
                options.maxItemCount ||= limit;
            }
            result = (await container.items.query(query, options).fetchAll()).resources;
        }
    }
    catch (err) {
        this.writeFail(['Unable to execute database query', data.service], err);
    }
    if (result) {
        if (cacheKey) {
            CACHE_DB[cacheKey] = result;
        }
        return result;
    }
    return [];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateStorage, createStorageClient, validateDatabase, createDatabaseClient, deleteObjects, executeQuery };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}