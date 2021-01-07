import type { CloudFeatures, CloudFunctions, ExtendedSettings, ExternalAsset, ICloud, IFileManager, internal } from '../types/lib';
import type { CloudDatabase, CloudService, CloudStorage, CloudStorageAction, CloudStorageDownload, CloudStorageUpload } from '../types/lib/squared';
import type { IChromeDocument } from '../document/chrome';

import path = require('path');
import fs = require('fs-extra');
import escapeRegexp = require('escape-string-regexp');
import mime = require('mime-types');
import uuid = require('uuid');

import Module from '../module';

type CloudModule = ExtendedSettings.CloudModule;

type ServiceClient = internal.Cloud.ServiceClient;
type UploadHost = internal.Cloud.UploadHost;
type UploadCallback = internal.Cloud.UploadCallback;
type DownloadHost = internal.Cloud.DownloadHost;
type DownloadCallback = internal.Cloud.DownloadCallback;
type FinalizeResult = internal.Cloud.FinalizeResult;
type CacheTimeout = internal.Cloud.CacheTimeout;

const CLOUD_SERVICE: ObjectMap<ServiceClient> = {};
const CLOUD_UPLOAD: ObjectMap<UploadHost> = {};
const CLOUD_DOWNLOAD: ObjectMap<DownloadHost> = {};
const CLOUD_USERCACHE: ObjectMap<ObjectMap<[number, any[]]>> = {};
const CLOUD_DBCACHE: ObjectMap<ObjectMap<any[]>> = {};

function setUploadFilename(this: ICloud, upload: CloudStorageUpload, filename: string) {
    filename = filename.replace(/^\.*[\\/]+/, '');
    const index = filename.lastIndexOf('/');
    if (index !== -1) {
        const directory = filename.substring(0, index + 1);
        upload.pathname = upload.pathname ? this.joinPosix(upload.pathname, directory) : directory;
        filename = filename.substring(index + 1);
    }
    return upload.filename = filename;
}

function hasSameBucket(provider: CloudStorage, other: CloudStorage) {
    const endpoint = provider.upload!.endpoint;
    return (provider.service && other.service || endpoint && endpoint === other.upload!.endpoint) && provider.bucket === other.bucket;
}

const assignFilename = (value: string) => uuid.v4() + (path.extname(value) || '');

class Cloud extends Module implements ICloud {
    public static async finalize(this: IFileManager, cloud: ICloud) {
        let tasks: Promise<unknown>[] = [];
        const deleted: string[] = [];
        const compressed = new WeakSet<ExternalAsset>();
        const cloudMap: ObjectMap<ExternalAsset> = {};
        const cloudCssMap: ObjectMap<ExternalAsset> = {};
        const localStorage = new Map<ExternalAsset, CloudStorageUpload>();
        const bucketGroup = uuid.v4();
        const chromeDocument = this.Document.find(item => item.document.documentName === 'chrome')?.document as Undef<IChromeDocument>;
        const { htmlFiles = [], cssFiles = [] } = chromeDocument || {} as IChromeDocument;
        const rawFiles: ExternalAsset[] = [];
        const compressFormat = new Set(['.map', '.gz', '.br']);
        let endpoint: Undef<string>,
            modifiedHtml: Undef<boolean>,
            modifiedCss: Undef<Set<ExternalAsset>>;
        if (this.Compress) {
            for (const format in this.Compress.compressorProxy) {
                compressFormat.add('.' + format);
            }
        }
        cloud.setObjectKeys(this.assets);
        if (htmlFiles.length === 1) {
            const upload = cloud.getStorage('upload', htmlFiles[0].cloudStorage)?.upload;
            if (upload && upload.endpoint) {
                endpoint = Module.toPosix(upload.endpoint) + '/';
            }
        }
        const getFiles = (item: ExternalAsset, data: CloudStorageUpload) => {
            const files = [item.fileUri!];
            const transforms: string[] = [];
            if (item.transforms && data.all) {
                for (const value of item.transforms) {
                    const ext = path.extname(value);
                    if (compressFormat.has(ext) && value === files[0] + ext) {
                        files.push(value);
                    }
                    else if (!item.cloudUri) {
                        transforms.push(value);
                    }
                }
            }
            return [files, transforms];
        };
        const uploadFiles = (item: ExternalAsset, mimeType = item.mimeType) => {
            const cloudMain = cloud.getStorage('upload', item.cloudStorage);
            for (const storage of item.cloudStorage!) {
                if (cloud.hasStorage('upload', storage)) {
                    const upload = storage.upload!;
                    if (storage === cloudMain && upload.localStorage === false) {
                        localStorage.set(item, upload);
                    }
                    let uploadHandler: UploadCallback;
                    try {
                        uploadHandler = cloud.getUploadHandler(storage.service, cloud.getCredential(storage));
                    }
                    catch (err) {
                        this.writeFail(['Upload function not supported', storage.service], err);
                        continue;
                    }
                    tasks.push(new Promise<void>(resolve => {
                        const uploadTasks: Promise<string>[] = [];
                        const files = getFiles(item, upload);
                        for (let i = 0, length = files.length; i < length; ++i) {
                            const group = files[i];
                            for (const fileUri of group) {
                                if (i === 0 || this.has(fileUri)) {
                                    const fileGroup: [Buffer | string, string][] = [];
                                    if (i === 0) {
                                        for (let j = 1; j < group.length; ++j) {
                                            try {
                                                fileGroup.push([storage.service === 'gcloud' ? group[j] : fs.readFileSync(group[j]), path.extname(group[j])]);
                                            }
                                            catch (err) {
                                                this.writeFail('File not found', err);
                                            }
                                        }
                                    }
                                    uploadTasks.push(
                                        new Promise(success => {
                                            fs.readFile(fileUri, (err, buffer) => {
                                                if (!err) {
                                                    let filename: Undef<string>;
                                                    if (i === 0) {
                                                        if (item.cloudUri) {
                                                            filename = path.basename(item.cloudUri);
                                                        }
                                                        else if (upload.filename) {
                                                            filename = this.assignFilename(upload);
                                                        }
                                                        else if (upload.overwrite) {
                                                            filename = path.basename(fileUri);
                                                        }
                                                    }
                                                    uploadHandler({ buffer, upload, fileUri, fileGroup, bucket: storage.bucket, bucketGroup, filename, mimeType: mimeType || mime.lookup(fileUri) || undefined }, success);
                                                }
                                                else {
                                                    success('');
                                                }
                                            });
                                        })
                                    );
                                    if (i === 0) {
                                        break;
                                    }
                                }
                            }
                            Promise.all(uploadTasks)
                                .then(result => {
                                    if (storage === cloudMain && result[0]) {
                                        let cloudUri = result[0];
                                        if (endpoint) {
                                            cloudUri = cloudUri.replace(new RegExp(escapeRegexp(endpoint), 'g'), '');
                                        }
                                        if (item.inlineCloud) {
                                            for (const content of htmlFiles) {
                                                content.sourceUTF8 = this.getUTF8String(content).replace(item.inlineCloud, cloudUri);
                                                delete cloudMap[item.inlineCloud];
                                            }
                                        }
                                        else if (item.inlineCssCloud) {
                                            const pattern = new RegExp(item.inlineCssCloud, 'g');
                                            for (const content of htmlFiles) {
                                                content.sourceUTF8 = this.getUTF8String(content).replace(pattern, cloudUri);
                                            }
                                            if (endpoint && cloudUri.indexOf('/') !== -1) {
                                                cloudUri = result[0];
                                            }
                                            for (const content of cssFiles) {
                                                if (content.inlineCssMap) {
                                                    content.sourceUTF8 = this.getUTF8String(content).replace(pattern, cloudUri);
                                                    modifiedCss!.add(content);
                                                }
                                            }
                                            delete cloudCssMap[item.inlineCssCloud];
                                        }
                                        item.cloudUri = cloudUri;
                                    }
                                    resolve();
                                })
                                .catch(() => resolve());
                        }
                    }));
                }
            }
        };
        const bucketMap: ObjectMap<Map<string, PlainObject>> = {};
        for (const item of this.assets) {
            if (item.cloudStorage) {
                if (item.fileUri) {
                    if (item.inlineCloud) {
                        cloudMap[item.inlineCloud] = item;
                        modifiedHtml = true;
                    }
                    else if (item.inlineCssCloud) {
                        cloudCssMap[item.inlineCssCloud] = item;
                        modifiedCss = new Set();
                    }
                    switch (item.mimeType) {
                        case '@text/html':
                        case '@text/css':
                            break;
                        default:
                            if (item.compress) {
                                await this.compressFile(item);
                            }
                            compressed.add(item);
                            rawFiles.push(item);
                            break;
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
            await Promise.all(tasks).catch(err => this.writeFail(['Empty buckets in cloud storage', 'finalize'], err));
            tasks = [];
        }
        for (const item of rawFiles) {
            uploadFiles(item);
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => this.writeFail(['Upload raw assets to cloud storage', 'finalize'], err));
            tasks = [];
        }
        if (modifiedCss) {
            for (const id in cloudCssMap) {
                for (const item of cssFiles) {
                    const inlineCssMap = item.inlineCssMap;
                    if (inlineCssMap && inlineCssMap[id]) {
                        item.sourceUTF8 = this.getUTF8String(item).replace(new RegExp(id, 'g'), inlineCssMap[id]!);
                        modifiedCss.add(item);
                    }
                }
                localStorage.delete(cloudCssMap[id]);
            }
            if (modifiedCss.size) {
                tasks.push(...Array.from(modifiedCss).map(item => fs.writeFile(item.fileUri!, item.sourceUTF8, 'utf8')));
            }
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => this.writeFail(['Update CSS', 'finalize'], err));
            tasks = [];
        }
        for (const item of cssFiles) {
            if (item.cloudStorage) {
                if (item.compress) {
                    await this.compressFile(item);
                }
                compressed.add(item);
                uploadFiles(item, 'text/css');
            }
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => this.writeFail(['Upload CSS to cloud storage', 'finalize'], err));
            tasks = [];
        }
        if (modifiedHtml) {
            for (const item of htmlFiles) {
                let sourceUTF8 = this.getUTF8String(item);
                for (const id in cloudMap) {
                    const file = cloudMap[id];
                    sourceUTF8 = sourceUTF8.replace(id, file.relativePath!);
                    localStorage.delete(file);
                }
                if (endpoint) {
                    sourceUTF8 = sourceUTF8.replace(endpoint, '');
                }
                try {
                    fs.writeFileSync(item.fileUri!, sourceUTF8, 'utf8');
                }
                catch (err) {
                    this.writeFail(['Update HTML', 'finalize'], err);
                }
                if (item.compress) {
                    await this.compressFile(item);
                }
                compressed.add(item);
                if (item.cloudStorage) {
                    uploadFiles(item, 'text/html');
                }
            }
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => this.writeFail(['Upload HTML to cloud storage', 'finalize'], err));
            tasks = [];
        }
        for (const [item, data] of localStorage) {
            for (const group of getFiles(item, data)) {
                if (group.length) {
                    tasks.push(
                        ...group.map(value => {
                            return fs.unlink(value)
                                .then(() => {
                                    deleted.push(value);
                                    this.delete(value);
                                })
                                .catch(() => this.delete(value));
                        })
                    );
                }
            }
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => this.writeFail(['Delete cloud temporary files', 'finalize'], err));
            tasks = [];
        }
        const downloadMap: ObjectMap<Set<string>> = {};
        for (const item of this.assets) {
            if (item.cloudStorage) {
                for (const data of item.cloudStorage) {
                    if (cloud.hasStorage('download', data)) {
                        const { active, pathname, filename, overwrite } = data.download!;
                        if (filename) {
                            const fileUri = item.fileUri;
                            let valid = false,
                                downloadUri = pathname ? path.join(this.baseDirectory, pathname.replace(/^([A-Z]:)?[\\/]+/i, '')) : data.admin?.preservePath && fileUri ? path.join(path.dirname(fileUri), filename) : path.join(this.baseDirectory, filename);
                            if (fs.existsSync(downloadUri)) {
                                if (active || overwrite) {
                                    valid = true;
                                }
                            }
                            else {
                                if (active && fileUri && path.extname(fileUri) === path.extname(downloadUri)) {
                                    downloadUri = fileUri;
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
                                                    this.writeFail(['Write buffer', data.service], err);
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
            await Promise.all(tasks).catch(err => this.writeFail(['Download from cloud storage', 'finalize'], err));
        }
        return { deleted, compressed } as FinalizeResult;
    }

    public cacheExpires = 10 * 60 * 1000;

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
                            setUploadFilename.call(this, upload, Cloud.toPosix(upload.filename));
                        }
                        if (upload.pathname) {
                            upload.pathname = Cloud.toPosix(upload.pathname).replace(/^\/+/, '') + '/';
                        }
                        else if (data.admin?.preservePath && item.pathname) {
                            upload.pathname = Cloud.toPosix(this.joinPosix(item.moveTo, item.pathname)) + '/';
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
                        const trailingName = this.joinPosix(trailingFolder, filename);
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
                                            const leadingName = this.joinPosix(leadingFolder, leading.filename || previous.filename);
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
        this.writeFail(['Create bucket function not supported', service]);
        return Promise.resolve(false);
    }
    deleteObjects(service: string, credential: PlainObject, bucket: string): Promise<void> {
        const deleteHandler = (CLOUD_SERVICE[service] ||= require('../cloud/' + service) as ServiceClient).deleteObjects?.bind(this);
        if (deleteHandler) {
            return deleteHandler.call(this, credential, bucket, service);
        }
        this.writeFail(['Delete objects function not supported', service]);
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