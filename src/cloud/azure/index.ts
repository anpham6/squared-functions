import type * as storage from '@azure/storage-blob';
import type * as db from '@azure/cosmos';

type CloudDatabase = functions.squared.CloudDatabase;
type InstanceHost = functions.internal.Cloud.InstanceHost;

const CACHE_DB: ObjectMap<any[]> = {};

export interface AzureStorageCredential extends functions.external.Cloud.StorageSharedKeyCredential {}

export interface AzureDatabaseCredential extends db.CosmosClientOptions {}

export interface AzureDatabaseQuery extends functions.squared.CloudDatabase<string> {
    partitionKey?: string;
}

export function validateStorage(credential: AzureStorageCredential) {
    return !!(credential.accountName && credential.accountKey || credential.connectionString || credential.sharedAccessSignature);
}

export function validateDatabase(credential: AzureDatabaseCredential, data: CloudDatabase) {
    return !!(credential.key && credential.endpoint && data.name && data.table);
}

export function createStorageClient(this: InstanceHost, credential: AzureStorageCredential): storage.BlobServiceClient {
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

export function createDatabaseClient(this: InstanceHost, credential: AzureDatabaseCredential): db.CosmosClient {
    try {
        const { CosmosClient } = require('@azure/cosmos');
        return new CosmosClient(credential);
    }
    catch (err) {
        this.writeFail([`Install Azure Cosmos DB?`, 'npm i @azure/cosmos']);
        throw err;
    }
}

export async function createBucket(this: InstanceHost, credential: AzureStorageCredential, bucket: string, publicRead?: boolean, service = 'azure') {
    const blobServiceClient = createStorageClient.call(this, credential);
    try {
        const containerClient = blobServiceClient.getContainerClient(bucket);
        if (!await containerClient.exists()) {
            const response = await containerClient.create({ access: publicRead ? 'blob' : 'container' });
            if (response.errorCode) {
                this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Container created with errors', 'Error code: ' + response.errorCode], bucket, 'yellow');
            }
            else {
                this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Container created', bucket, 'blue');
            }
        }
    }
    catch (err) {
        if (err.code !== 'ContainerAlreadyExists') {
            this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Unable to create container', bucket], err, 'red');
            return false;
        }
    }
    return true;
}

export async function deleteObjects(this: InstanceHost, credential: AzureStorageCredential, bucket: string, service = 'azure') {
    try {
        const containerClient = createStorageClient.call(this, credential).getContainerClient(bucket);
        const tasks: Promise<storage.BlobDeleteResponse>[] = [];
        let fileCount = 0;
        for await (const blob of containerClient.listBlobsFlat({ includeUncommitedBlobs: true })) {
            tasks.push(
                containerClient.deleteBlob(blob.name, { versionId: blob.versionId })
                    .catch(err => {
                        this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Unable to delete blob', bucket], err, 'yellow');
                        --fileCount;
                        return err;
                    })
            );
        }
        fileCount = tasks.length;
        return Promise.all(tasks).then(() => this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Container emptied', fileCount + ' files'], bucket, 'blue'));
    }
    catch (err) {
        this.formatMessage(this.logType.CLOUD_STORAGE, service, ['Unable to empty container', bucket], err, 'yellow');
    }
}

export async function executeQuery(this: InstanceHost, credential: AzureDatabaseCredential, data: AzureDatabaseQuery, cacheKey?: string) {
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