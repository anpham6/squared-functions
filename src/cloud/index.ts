import type { CloudFeatures, CloudFunctions, ExtendedSettings, ExternalAsset, ICloud, IFileManager, Internal } from '../types/lib';
import type { CloudDatabase, CloudService, CloudStorage, CloudStorageAction, CloudStorageDownload, CloudStorageUpload } from '../types/lib/squared';

import path = require('path');
import fs = require('fs-extra');
import mime = require('mime-types');
import uuid = require('uuid');

import Module from '../module';

type CloudModule = ExtendedSettings.CloudModule;

type ServiceClient = Internal.Cloud.ServiceClient;
type UploadHost = Internal.Cloud.UploadHost;
type UploadCallback = Internal.Cloud.UploadCallback;
type DownloadHost = Internal.Cloud.DownloadHost;
type DownloadCallback = Internal.Cloud.DownloadCallback;
type FinalizeState = Internal.Cloud.FinalizeState;
type FinalizeResult = Internal.Cloud.FinalizeResult;
type CacheTimeout = Internal.Cloud.CacheTimeout;

const CLOUD_SERVICE: ObjectMap<ServiceClient> = {};
const CLOUD_UPLOAD: ObjectMap<UploadHost> = {};
const CLOUD_DOWNLOAD: ObjectMap<DownloadHost> = {};
const CLOUD_USERCACHE: ObjectMap<ObjectMap<[number, any[]]>> = {};
const CLOUD_DBCACHE: ObjectMap<ObjectMap<any[]>> = {};

function setUploadFilename(upload: CloudStorageUpload, filename: string) {
    filename = filename.replace(/^\.*[\\/]+/, '');
    const index = filename.lastIndexOf('/');
    if (index !== -1) {
        const directory = filename.substring(0, index + 1);
        upload.pathname = upload.pathname ? Module.joinPosix(upload.pathname, directory) : directory;
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
            else if (!file.cloudUri) {
                transforms.push(value);
            }
        }
    }
    return [files, transforms];
}

const assignFilename = (value: string) => uuid.v4() + (path.extname(value) || '');

class Cloud extends Module implements ICloud {
    public static uploadAsset(this: IFileManager, state: FinalizeState, file: ExternalAsset, mimeType = file.mimeType, uploadDocument?: boolean) {
        const { cloud, bucketGroup } = state;
        const tasks: Promise<void>[] = [];
        for (const storage of file.cloudStorage!) {
            if (cloud.hasStorage('upload', storage)) {
                const upload = storage.upload!;
                const active = storage === cloud.getStorage('upload', file.cloudStorage);
                if (active && upload.localStorage === false) {
                    state.localStorage.set(file, upload);
                }
                let uploadHandler: UploadCallback;
                try {
                    uploadHandler = cloud.getUploadHandler(storage.service, cloud.getCredential(storage));
                }
                catch (err) {
                    this.writeFail(['Upload function not supported', storage.service], err);
                    continue;
                }
                const bucket = storage.bucket;
                tasks.push(new Promise<void>(resolve => {
                    const uploadTasks: Promise<string>[] = [];
                    getFiles(cloud, file, upload).forEach((group, index) => {
                        for (const localUri of group) {
                            if (index === 0 || this.has(localUri)) {
                                const fileGroup: [Buffer | string, string][] = [];
                                if (index === 0) {
                                    for (let i = 1; i < group.length; ++i) {
                                        try {
                                            fileGroup.push([storage.service === 'gcloud' ? group[i] : fs.readFileSync(group[i]), path.extname(group[i])]);
                                        }
                                        catch (err) {
                                            this.writeFail('File not found', err);
                                        }
                                    }
                                }
                                uploadTasks.push(
                                    new Promise(success => {
                                        fs.readFile(localUri, (err, buffer) => {
                                            if (!err) {
                                                let filename: Undef<string>;
                                                if (index === 0) {
                                                    if (file.cloudUri) {
                                                        filename = path.basename(file.cloudUri);
                                                    }
                                                    else if (upload.filename) {
                                                        filename = this.assignUUID(file, 'filename', upload);
                                                    }
                                                    else if (upload.overwrite) {
                                                        filename = path.basename(localUri);
                                                    }
                                                }
                                                else {
                                                    mimeType = mime.lookup(localUri) || file.mimeType;
                                                }
                                                uploadHandler({ buffer, upload, localUri, fileGroup, bucket, bucketGroup, filename, mimeType }, success);
                                            }
                                            else {
                                                success('');
                                            }
                                        });
                                    })
                                );
                                if (index === 0) {
                                    break;
                                }
                            }
                        }
                        Module.allSettled(uploadTasks, ['Upload file <cloud storage>', path.basename(file.localUri!)], this.errors).then(async result => {
                            if (!uploadDocument) {
                                for (const item of result) {
                                    if (item.status === 'fulfilled' && item.value) {
                                        for (const { instance } of this.Document) {
                                            if (instance.cloudUpload && await instance.cloudUpload(state, file, item.value, active)) {
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

    public static async finalize(this: IFileManager, cloud: ICloud) {
        const compressed: ExternalAsset[] = [];
        const localStorage = new Map<ExternalAsset, CloudStorageUpload>();
        const bucketGroup = uuid.v4();
        const state: FinalizeState = { manager: this, cloud, bucketGroup, localStorage, compressed };
        const bucketMap: ObjectMap<Map<string, PlainObject>> = {};
        const downloadMap: ObjectMap<Set<string>> = {};
        const rawFiles: ExternalAsset[] = [];
        let tasks: Promise<unknown>[] = [];
        if (this.Compress) {
            for (const format in this.Compress.compressorProxy) {
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
                            await this.compressFile(item);
                            compressed.push(item);
                        }
                        rawFiles.push(item);
                    }
                }
                for (const storage of item.cloudStorage) {
                    if (storage.admin?.emptyBucket && cloud.hasCredential('storage', storage) && storage.bucket && !(bucketMap[storage.service] ||= new Map()).has(storage.bucket)) {
                        bucketMap[storage.service].set(storage.bucket, cloud.getCredential(storage));
                    }
                }
            }
        }
        for (const service in bucketMap) {
            for (const [bucket, credential] of bucketMap[service]) {
                tasks.push(cloud.deleteObjects(service, credential, bucket).catch(err => this.writeFail(['Cloud provider not found', service], err)));
            }
        }
        if (tasks.length) {
            await Module.allSettled(tasks, ['Empty bucket <finalize>', 'cloud storage'], this.errors);
            tasks = [];
        }
        if (rawFiles.length) {
            for (const item of rawFiles) {
                tasks.push(...Cloud.uploadAsset.call(this, state, item));
            }
            if (tasks.length) {
                await Module.allSettled(tasks, ['Upload raw assets <finalize>', 'cloud storage'], this.errors);
                tasks = [];
            }
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
            await Module.allSettled(tasks, ['Delete temporary files <finalize>', 'cloud storage'], this.errors);
            tasks = [];
        }
        for (const item of this.assets) {
            if (item.cloudStorage) {
                for (const data of item.cloudStorage) {
                    if (cloud.hasStorage('download', data)) {
                        const { pathname, filename, active, overwrite } = data.download!;
                        if (filename) {
                            const localUri = item.localUri;
                            let valid = false,
                                downloadUri = pathname ? path.join(this.baseDirectory, pathname.replace(/^([A-Z]:)?[\\/]+/i, '')) : data.admin?.preservePath && localUri ? path.join(path.dirname(localUri), filename) : path.join(this.baseDirectory, filename);
                            if (fs.existsSync(downloadUri)) {
                                valid = !!(active || overwrite);
                            }
                            else {
                                if (active && localUri && path.extname(localUri) === path.extname(downloadUri)) {
                                    downloadUri = localUri;
                                }
                                try {
                                    fs.mkdirpSync(path.dirname(downloadUri));
                                }
                                catch (err) {
                                    this.writeFail('Unable to create directory', err);
                                    continue;
                                }
                                valid = true;
                            }
                            if (valid) {
                                const location = data.service + data.bucket + filename;
                                if (downloadMap[location]) {
                                    downloadMap[location].add(downloadUri);
                                }
                                else {
                                    try {
                                        tasks.push(cloud.downloadObject(data.service, cloud.getCredential(data), data.bucket!, data.download!, (value: Null<Buffer | string>) => {
                                            if (value) {
                                                try {
                                                    const items = Array.from(downloadMap[location]);
                                                    for (let i = 0, length = items.length; i < length; ++i) {
                                                        const destUri = items[i];
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
                                                    this.writeFail(['Unable to write buffer', data.service], err);
                                                }
                                            }
                                        }, bucketGroup));
                                        downloadMap[location] = new Set<string>([downloadUri]);
                                    }
                                    catch (err) {
                                        this.writeFail(['Download function not supported', data.service], err);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if (tasks.length) {
            await Module.allSettled(tasks, ['Download objects <finalize>', 'cloud storage'], this.errors);
        }
        return { compressed } as FinalizeResult;
    }

    public cacheExpires = 10 * 60 * 1000;
    public compressFormat = new Set(['.map', '.gz', '.br']);

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
                        if (upload.pathname) {
                            upload.pathname = Cloud.toPosix(upload.pathname).replace(/^\/+/, '') + '/';
                        }
                        else if (data.admin?.preservePath && item.pathname) {
                            upload.pathname = Cloud.toPosix(Module.joinPosix(item.moveTo, item.pathname)) + '/';
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
                        const trailingName = Module.joinPosix(trailingFolder, filename);
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
                                            trailing.filename = value.substring(0, index !== -1 ? index : Infinity) + `_${filenameMap[location]++}` + (index !== -1 ? value.substring(index) : '');
                                        };
                                        if (basename && basename === leading.filename && leadingFolder === trailingFolder) {
                                            renameTrailing(basename);
                                            break renamed;
                                        }
                                        else {
                                            const leadingName = Module.joinPosix(leadingFolder, leading.filename || previous.filename);
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
        const createHandler = (CLOUD_SERVICE[service] ||= require('../cloud/' + service) as ServiceClient).createBucket?.bind(this);
        if (createHandler) {
            return createHandler.call(this, credential, bucket, publicRead);
        }
        this.writeFail(['Create bucket function not supported', service], new Error(`Insufficent permissions <${service}:${bucket}>`));
        return Promise.resolve(false);
    }
    deleteObjects(service: string, credential: PlainObject, bucket: string): Promise<void> {
        const deleteHandler = (CLOUD_SERVICE[service] ||= require('../cloud/' + service) as ServiceClient).deleteObjects?.bind(this);
        if (deleteHandler) {
            return deleteHandler.call(this, credential, bucket, service);
        }
        this.writeFail(['Delete objects function not supported', service], new Error(`Insufficent permissions <${service}:${bucket}>`));
        return Promise.resolve();
    }
    downloadObject(service: string, credential: PlainObject, bucket: string, download: CloudStorageDownload, callback: (value: Null<Buffer | string>) => void, bucketGroup?: string) {
        const downloadHandler = this.getDownloadHandler(service, credential).bind(this);
        return new Promise<void>(resolve => {
            downloadHandler({ bucket, bucketGroup, download }, async (value: Null<Buffer | string>) => {
                await callback(value);
                resolve();
            });
        });
    }
    getDatabaseRows(data: CloudDatabase, cacheKey?: string): Promise<PlainObject[]> {
        if (this.hasCredential('database', data)) {
            const host = CLOUD_SERVICE[data.service];
            if (host.executeQuery) {
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
                const [expires, result] = userCache[queryString];
                if (Date.now() < expires) {
                    return result;
                }
                delete userCache[queryString];
            }
        }
        else if (cacheKey) {
            const dbCache = CLOUD_DBCACHE[userKey];
            if (dbCache) {
                return dbCache[cacheKey + queryString];
            }
        }
    }
    setDatabaseResult(service: string, credential: PlainObject, queryString: string, result: any[], cacheKey?: string) {
        const userKey = service + JSON.stringify(credential);
        const timeout = this._cache[service];
        if (timeout > 0) {
            (CLOUD_USERCACHE[userKey] ||= {})[queryString] = [Date.now() + timeout * 1000, result];
        }
        else if (cacheKey) {
            cacheKey += queryString;
            (CLOUD_DBCACHE[userKey] ||= {})[cacheKey] = result;
            setTimeout(() => delete CLOUD_DBCACHE[userKey][cacheKey!], this.cacheExpires);
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
            const client = CLOUD_SERVICE[data.service] ||= require('../cloud/' + data.service) as ServiceClient;
            const credential = this.getCredential(data);
            switch (feature) {
                case 'storage':
                    return typeof client.validateStorage === 'function' && client.validateStorage(credential, data);
                case 'database':
                    return typeof client.validateDatabase === 'function' && client.validateDatabase(credential, data);
            }
        }
        catch (err) {
            this.writeFail(['Cloud provider not found', data.service], err);
        }
        return false;
    }
    getUploadHandler(service: string, credential: PlainObject): UploadCallback {
        return (CLOUD_UPLOAD[service] ||= require(`../cloud/${service}/upload`) as UploadHost).call(this, credential, service);
    }
    getDownloadHandler(service: string, credential: PlainObject): DownloadCallback {
        return (CLOUD_DOWNLOAD[service] ||= require(`../cloud/${service}/download`) as DownloadHost).call(this, credential, service);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Cloud;
    module.exports.default = Cloud;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Cloud;