import type { ICloud, ICloudServiceClient, IFileManager, IModule, IScopeOrigin } from '../types/lib';
import type { ExternalAsset } from '../types/lib/asset';
import type { CacheTimeout, CloudDatabase, CloudFeatures, CloudFunctions, CloudService, CloudStorage, CloudStorageAction, CloudStorageDownload, CloudStorageUpload, DownloadData, UploadData } from '../types/lib/cloud';
import type { CloudModule } from '../types/lib/module';

import { ERR_MESSAGE } from '../types/lib/logger';

import path = require('path');
import fs = require('fs-extra');
import mime = require('mime-types');
import uuid = require('uuid');

import Module from '../module';

export const enum ERR_CLOUD { // eslint-disable-line no-shadow
    INSTALL_GCS = 'Install Google Cloud Storage?',
    INSTALL_CLOUDANT = 'Install IBM Cloudant?',
    INSTALL_ORACLEDB = 'Install Oracle DB?',
    CREATE_BUCKET = 'Unable to create bucket',
    DELETE_BUCKET = 'Unable to empty bucket',
    GRANT_PUBLICREAD = 'Unable to grant public-read',
    QUERY_DB = 'Unable to execute DB query',
    PROVIDER_NOTFOUND = 'Cloud provider not found',
    CREATE_BUCKET_SUPPORT = 'Create bucket not supported',
    DELETE_OBJECTS_SUPPORT = 'Delete objects not supported',
    UPLOAD_SUPPORT = 'Upload function not supported',
    DOWNLOAD_SUPPORT = 'Download function not supported',
    UPLOAD_FAIL = 'Upload failed',
    DOWNLOAD_FAIL = 'Download failed',
    DELETE_FAIL = 'Delete failed'
}

export const enum ERR_AWS { // eslint-disable-line no-shadow
    INSTALL_AWS = 'Install AWS SDK?',
    INSTALL_AWS3 = 'Install AWS SDK S3 v3?',
    INSTALL_DYNAMODB = 'Install AWS SDK DynamoDB v3?'
}

export const enum ERR_AZURE { // eslint-disable-line no-shadow
    INSTALL_STORAGEBLOB = 'Install Azure Storage Blob?',
    INSTALL_COSMOSDB = 'Install Azure Cosmos DB?',
    CREATE_CONTAINER = 'Unable to create container',
    DELETE_CONTAINER = 'Unable to empty container',
    DELETE_BLOB = 'Unable to delete blob'
}

export interface CloudScopeOrigin extends Required<IScopeOrigin<IFileManager, ICloud>> {
    bucketGroup: string;
    localStorage: Map<ExternalAsset, CloudStorageUpload>;
}

export type ServiceHost<T> = (this: IModule, credential: unknown, service?: string, sdk?: string) => T;
export type UploadCallback = (data: UploadData, success: (value: string) => void) => Promise<void>;
export type DownloadCallback = (data: DownloadData, success: (value: Null<BufferContent>) => void) => Promise<void>;
export type UploadHost = ServiceHost<UploadCallback>;
export type DownloadHost = ServiceHost<DownloadCallback>;

const CLOUD_SERVICE: ObjectMap<ICloudServiceClient> = {};
const CLOUD_UPLOAD: ObjectMap<UploadHost> = {};
const CLOUD_DOWNLOAD: ObjectMap<DownloadHost> = {};
const CLOUD_USERCACHE: ObjectMap<Undef<ObjectMap<[number, any[]]>>> = {};
const CLOUD_DBCACHE: ObjectMap<Undef<ObjectMap<any[]>>> = {};

function setUploadFilename(upload: CloudStorageUpload, filename: string) {
    filename = filename.replace(/^\.*[\\/]+/, '');
    const index = filename.lastIndexOf('/');
    if (index !== -1) {
        const directory = filename.substring(0, index + 1);
        upload.pathname = upload.pathname ? Module.joinPath(upload.pathname, directory) : directory;
        filename = filename.substring(index + 1);
    }
    return upload.filename = filename;
}

function hasSameBucket(provider: CloudStorage, other: CloudStorage) {
    const endpoint = provider.upload!.endpoint;
    return (provider.service && other.service || endpoint && endpoint === other.upload!.endpoint) && provider.bucket === other.bucket;
}

function getFiles(cloud: ICloud, file: ExternalAsset, data: CloudStorageUpload) {
    const files = [file.localUri!];
    const transforms: string[] = [];
    if (file.transforms && data.all) {
        for (const value of file.transforms) {
            const ext = path.extname(value);
            if (cloud.compressFormat.has(ext) && value === files[0] + ext) {
                files.push(value);
            }
            else if (!file.cloudUrl) {
                transforms.push(value);
            }
        }
    }
    return [files, transforms];
}

const assignFilename = (value: string) => uuid.v4() + (path.extname(value) || '');

class Cloud extends Module implements ICloud {
    static uploadAsset(this: IFileManager, state: CloudScopeOrigin, file: ExternalAsset, mimeType = file.mimeType, uploadDocument?: boolean) {
        const { instance, bucketGroup } = state;
        const tasks: Promise<void>[] = [];
        for (const storage of file.cloudStorage!) {
            if (instance.hasStorage('upload', storage)) {
                const upload = storage.upload!;
                const active = storage === instance.getStorage('upload', file.cloudStorage);
                if (active && upload.localStorage === false) {
                    state.localStorage.set(file, upload);
                }
                let uploadHandler: UploadCallback;
                try {
                    uploadHandler = instance.getUploadHandler(storage.service, instance.getCredential(storage));
                }
                catch (err) {
                    instance.writeFail([ERR_CLOUD.UPLOAD_SUPPORT, storage.service], err);
                    continue;
                }
                const { admin, bucket } = storage;
                tasks.push(new Promise<void>(resolve => {
                    const uploadTasks: Promise<string>[] = [];
                    getFiles(instance, file, upload).forEach((group, index) => {
                        for (const localUri of group) {
                            if (index === 0 || this.has(localUri)) {
                                const fileGroup: [BufferContent, string][] = [];
                                if (index === 0) {
                                    for (let i = 1; i < group.length; ++i) {
                                        try {
                                            fileGroup.push([storage.service === 'gcloud' ? group[i] : fs.readFileSync(group[i]), path.extname(group[i])]);
                                        }
                                        catch (err) {
                                            instance.writeFail([ERR_MESSAGE.READ_FILE, group[i]], err, this.logType.FILE);
                                        }
                                    }
                                }
                                uploadTasks.push(
                                    new Promise(success => {
                                        try {
                                            const buffer = fs.readFileSync(localUri);
                                            let filename: Undef<string>;
                                            if (index === 0) {
                                                if (file.cloudUrl) {
                                                    filename = path.basename(file.cloudUrl);
                                                }
                                                else if (upload.filename) {
                                                    filename = upload.filename;
                                                }
                                                else if (upload.overwrite) {
                                                    filename = path.basename(localUri);
                                                }
                                            }
                                            else {
                                                mimeType = mime.lookup(localUri) || file.mimeType;
                                            }
                                            upload.bucketGroup = bucketGroup;
                                            uploadHandler({ buffer, admin, upload, localUri, fileGroup, bucket, filename, mimeType }, success);
                                        }
                                        catch (err) {
                                            instance.writeFail([ERR_MESSAGE.READ_FILE, localUri], err, this.logType.FILE);
                                            success('');
                                        }
                                    })
                                );
                                if (index === 0) {
                                    break;
                                }
                            }
                        }
                        Module.allSettled(uploadTasks, { rejected: ['Upload file <cloud storage>', file.localUri!], errors: this.errors }).then(async result => {
                            if (!uploadDocument) {
                                for (const item of result) {
                                    if (item.status === 'fulfilled' && item.value) {
                                        for (const { instance: document } of this.Document) {
                                            if (document.cloudUpload && await document.cloudUpload(state, file, item.value, active)) {
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            resolve();
                        });
                    });
                }));
            }
        }
        return tasks;
    }

    static async finalize(this: IFileManager, cloud: ICloud) {
        const localStorage = new Map<ExternalAsset, CloudStorageUpload>();
        const bucketGroup = uuid.v4();
        const state: CloudScopeOrigin = { host: this, instance: cloud, bucketGroup, localStorage };
        const bucketMap: ObjectMap<Map<string, PlainObject>> = {};
        const downloadMap: ObjectMap<Set<string>> = {};
        const rawFiles: ExternalAsset[] = [];
        let tasks: Promise<unknown>[] = [];
        if (this.Compress) {
            for (const format in this.Compress.compressors) {
                cloud.compressFormat.add('.' + format);
            }
        }
        cloud.setObjectKeys(this.assets);
        for (const { instance } of this.Document) {
            if (instance.cloudInit) {
                instance.cloudInit(state);
            }
        }
        for (const item of this.assets) {
            if (item.cloudStorage) {
                if (item.localUri) {
                    let ignore = false;
                    for (const { instance } of this.Document) {
                        if (instance.cloudObject && instance.cloudObject(state, item)) {
                            ignore = true;
                            break;
                        }
                    }
                    if (!ignore) {
                        if (item.compress) {
                            tasks.push(this.compressFile(item));
                        }
                        rawFiles.push(item);
                    }
                }
                let bucket: Map<string, PlainObject>;
                for (const storage of item.cloudStorage) {
                    if (storage.admin?.emptyBucket && cloud.hasCredential('storage', storage) && storage.bucket && !(bucket = bucketMap[storage.service] ||= new Map()).has(storage.bucket)) {
                        bucket.set(storage.bucket, cloud.getCredential(storage));
                    }
                }
            }
        }
        if (tasks.length) {
            await Module.allSettled(tasks, { rejected: ['Compress files', 'cloud storage'], errors: this.errors });
            tasks = [];
        }
        for (const service in bucketMap) {
            for (const [bucket, credential] of bucketMap[service]!) {
                tasks.push(cloud.deleteObjects(service, credential, bucket).catch(err => cloud.writeFail([ERR_CLOUD.PROVIDER_NOTFOUND, service], err)));
            }
        }
        if (tasks.length) {
            await Module.allSettled(tasks, { rejected: ['Empty bucket', 'cloud storage'], errors: this.errors });
            tasks = [];
        }
        for (const item of rawFiles) {
            tasks.push(...Cloud.uploadAsset.call(this, state, item));
        }
        if (tasks.length) {
            await Module.allSettled(tasks, { rejected: ['Upload raw assets', 'cloud storage'], errors: this.errors });
            tasks = [];
        }
        for (const { instance } of this.Document) {
            if (instance.cloudFinalize) {
                await instance.cloudFinalize(state);
            }
        }
        for (const [item, data] of localStorage) {
            for (const group of getFiles(cloud, item, data)) {
                if (group.length) {
                    tasks.push(...group.map(value => fs.unlink(value).then(() => this.delete(value)).catch(() => this.delete(value, false))));
                }
            }
        }
        if (tasks.length) {
            await Module.allSettled(tasks, { rejected: ['Delete temporary files', 'cloud storage'], errors: this.errors, type: this.logType.FILE });
            tasks = [];
        }
        for (const item of this.assets) {
            if (item.cloudStorage) {
                for (const data of item.cloudStorage) {
                    if (cloud.hasStorage('download', data)) {
                        const download = data.download!;
                        const { pathname, filename, active, overwrite } = download;
                        if (filename) {
                            const localUri = item.localUri;
                            let valid = false,
                                downloadUri = pathname ? path.join(this.baseDirectory, pathname.replace(/^([A-Z]:)?[\\/]+/i, ''), filename) : path.join(data.admin?.preservePath && localUri ? path.dirname(localUri) : this.baseDirectory, filename);
                            const dirname = path.dirname(downloadUri);
                            try {
                                if (fs.existsSync(downloadUri)) {
                                    valid = !!(active || overwrite);
                                }
                                else {
                                    if (active && localUri && path.extname(localUri) === path.extname(downloadUri)) {
                                        downloadUri = localUri;
                                    }
                                    if (Module.mkdirSafe(dirname)) {
                                        valid = true;
                                    }
                                }
                            }
                            catch (err) {
                                cloud.writeFail([ERR_MESSAGE.CREATE_DIRECTORY, dirname], err, this.logType.FILE);
                            }
                            if (valid) {
                                const location = data.service + data.bucket + filename;
                                let pending = downloadMap[location];
                                if (pending) {
                                    pending.add(downloadUri);
                                }
                                else {
                                    pending = new Set<string>([downloadUri]);
                                    try {
                                        download.bucketGroup = bucketGroup;
                                        tasks.push(cloud.downloadObject(data.service, cloud.getCredential(data), data.bucket!, download, (value: Null<BufferContent>) => {
                                            if (value) {
                                                let destUri = '';
                                                try {
                                                    const items = Array.from(pending!);
                                                    for (let i = 0, length = items.length; i < length; ++i) {
                                                        destUri = items[i];
                                                        if (typeof value === 'string') {
                                                            fs[i === length - 1 ? 'moveSync' : 'copySync'](value, destUri, { overwrite: true });
                                                        }
                                                        else {
                                                            fs.writeFileSync(destUri, value);
                                                        }
                                                        this.add(destUri);
                                                    }
                                                }
                                                catch (err) {
                                                    cloud.writeFail([ERR_MESSAGE.WRITE_FILE, destUri], err, this.logType.FILE);
                                                }
                                            }
                                        }));
                                        downloadMap[location] = pending;
                                    }
                                    catch (err) {
                                        cloud.writeFail([ERR_CLOUD.DOWNLOAD_SUPPORT, data.service], err);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if (tasks.length) {
            await Module.allSettled(tasks, { rejected: ['Download objects', 'cloud storage'], errors: this.errors });
        }
    }

    moduleName = 'cloud';
    cacheExpires = 10 * 60 * 1000;
    compressFormat = new Set(['.map', '.gz', '.br']);
    host?: IFileManager;

    private _cache: CacheTimeout = {};

    constructor(
        public settings: CloudModule = {},
        public database: CloudDatabase[] = [])
    {
        super();
        Object.assign(this._cache, settings.cache);
    }

    setObjectKeys(assets: ExternalAsset[]) {
        const storage: ExternalAsset[] = [];
        for (const item of assets) {
            if (item.cloudStorage) {
                for (const data of item.cloudStorage) {
                    const upload = data.upload;
                    if (upload) {
                        if (upload.filename) {
                            setUploadFilename(upload, Cloud.toPosix(upload.filename));
                        }
                        const pathname = upload.pathname || data.admin?.preservePath && item.pathname;
                        if (pathname) {
                            upload.pathname = Cloud.toPosix(pathname).replace(/^\/+/, '') + '/';
                        }
                    }
                }
                storage.push(item);
            }
        }
        const filenameMap: ObjectMap<number> = {};
        const length = storage.length;
        for (let i = length - 1; i > 0; --i) {
            const current = storage[i];
            for (const data of current.cloudStorage!) {
                const trailing = data.upload;
                if (trailing) {
                    renamed: {
                        const basename = trailing.filename;
                        const filename = basename || current.filename;
                        const trailingFolder = trailing.pathname || '';
                        const trailingName = Module.joinPath(trailingFolder, filename);
                        for (let j = 0; j < length - 1; ++j) {
                            const previous = storage[j];
                            if (current !== previous) {
                                for (const other of previous.cloudStorage!) {
                                    const leading = other.upload;
                                    if (leading && hasSameBucket(data, other)) {
                                        const leadingFolder = leading.pathname || '';
                                        const renameTrailing = (value: string) => {
                                            const location = trailingFolder + value;
                                            filenameMap[location] ||= 1;
                                            const index = value.indexOf('.');
                                            trailing.filename = value.substring(0, index !== -1 ? index : Infinity) + '_' + filenameMap[location]!++ + (index !== -1 ? value.substring(index) : '');
                                        };
                                        if (basename && basename === leading.filename && leadingFolder === trailingFolder) {
                                            renameTrailing(basename);
                                            break renamed;
                                        }
                                        else {
                                            const leadingName = Module.joinPath(leadingFolder, leading.filename || previous.filename);
                                            if (trailingName === leadingName) {
                                                if (!trailing.overwrite || leading.overwrite) {
                                                    renameTrailing(filename);
                                                    break renamed;
                                                }
                                                leading.filename = assignFilename(leading.filename || previous.filename);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    createBucket(service: string, credential: PlainObject, bucket: string, publicRead?: boolean): Promise<boolean> {
        const createHandler = (CLOUD_SERVICE[service] ||= require(this.resolveService(service)) as ICloudServiceClient).createBucket?.bind(this);
        if (createHandler) {
            return createHandler.call(this, credential, bucket, publicRead);
        }
        this.writeFail([ERR_CLOUD.CREATE_BUCKET_SUPPORT, service], new Error(service + `: ${bucket} (Create not supported)`));
        return Promise.resolve(false);
    }
    deleteObjects(service: string, credential: PlainObject, bucket: string): Promise<void> {
        const deleteHandler = (CLOUD_SERVICE[service] ||= require(this.resolveService(service)) as ICloudServiceClient).deleteObjects?.bind(this);
        if (deleteHandler) {
            return deleteHandler.call(this, credential, bucket, service);
        }
        this.writeFail([ERR_CLOUD.DELETE_OBJECTS_SUPPORT, service], new Error(service + `: ${bucket} (Delete not supported)`));
        return Promise.resolve();
    }
    downloadObject(service: string, credential: PlainObject, bucket: string, download: CloudStorageDownload, callback: (value: Null<BufferContent>) => void) {
        const downloadHandler = this.getDownloadHandler(service, credential).bind(this);
        return new Promise<void>(resolve => {
            downloadHandler({ bucket, download }, async (value: Null<BufferContent>) => {
                await callback(value);
                resolve();
            });
        });
    }
    getDatabaseRows(data: CloudDatabase, cacheKey?: string): Promise<unknown[]> {
        if (this.hasCredential('database', data)) {
            const host = CLOUD_SERVICE[data.service];
            if (host && host.executeQuery) {
                return host.executeQuery.call(this, this.getCredential(data), data, cacheKey);
            }
        }
        return Promise.resolve([]);
    }
    getDatabaseResult(service: string, credential: PlainObject, queryString: string, cacheKey?: string) {
        const userKey = service + JSON.stringify(credential);
        const timeout = this._cache[service];
        if (timeout > 0) {
            const userCache = CLOUD_USERCACHE[userKey];
            if (userCache && userCache[queryString]) {
                const [expires, result] = userCache[queryString]!;
                if (Date.now() < expires) {
                    return result;
                }
                delete userCache[queryString];
            }
        }
        else if (cacheKey && CLOUD_DBCACHE[userKey]) {
            return CLOUD_DBCACHE[userKey]![cacheKey + queryString];
        }
    }
    setDatabaseResult(service: string, credential: PlainObject, queryString: string, result: unknown[], cacheKey?: string) {
        const userKey = service + JSON.stringify(credential);
        const timeout = this._cache[service];
        if (timeout > 0) {
            (CLOUD_USERCACHE[userKey] ||= {})[queryString] = [Date.now() + timeout * 1000, result];
        }
        else if (cacheKey) {
            (CLOUD_DBCACHE[userKey] ||= {})[cacheKey += queryString] = result;
            setTimeout(() => delete CLOUD_DBCACHE[userKey]![cacheKey!], this.cacheExpires);
        }
    }
    getCredential(data: CloudService): PlainObject {
        return typeof data.credential === 'string' ? { ...this.settings[data.service] && this.settings[data.service][data.credential] } : { ...data.credential };
    }
    getStorage(action: CloudFunctions, data: Undef<CloudStorage[]>) {
        if (data) {
            for (const item of data) {
                const service = this.hasStorage(action, item);
                if (service && service.active) {
                    return item;
                }
            }
        }
    }
    hasStorage(action: CloudFunctions, storage: CloudStorage): CloudStorageAction | false {
        switch (action) {
            case 'upload':
                break;
            case 'download':
                if (!storage.bucket) {
                    return false;
                }
                break;
            default:
                return false;
        }
        const result = storage[action];
        return result && this.hasCredential('storage', storage) ? result : false;
    }
    hasCredential(feature: CloudFeatures, data: CloudService) {
        try {
            const client = CLOUD_SERVICE[data.service] ||= require(this.resolveService(data.service)) as ICloudServiceClient;
            const credential = this.getCredential(data);
            switch (feature) {
                case 'storage':
                    return typeof client.validateStorage === 'function' && client.validateStorage(credential, data);
                case 'database':
                    return typeof client.validateDatabase === 'function' && client.validateDatabase(credential, data);
            }
        }
        catch (err) {
            this.writeFail([ERR_CLOUD.PROVIDER_NOTFOUND, data.service], err);
        }
        return false;
    }
    getUploadHandler(service: string, credential: PlainObject): UploadCallback {
        return (CLOUD_UPLOAD[service] ||= require(this.resolveService(service, 'upload')) as UploadHost).call(this, credential, service);
    }
    getDownloadHandler(service: string, credential: PlainObject): DownloadCallback {
        return (CLOUD_DOWNLOAD[service] ||= require(this.resolveService(service, 'download')) as DownloadHost).call(this, credential, service);
    }
    resolveService(service: string, folder?: string) {
        let result = path.join(__dirname, service),
            sep = path.sep;
        try {
            if (!fs.existsSync(result)) {
                result = service;
                sep = '/';
            }
        }
        catch {
        }
        return result + (folder ? sep + folder : '');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Cloud;
    module.exports.default = Cloud;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Cloud;