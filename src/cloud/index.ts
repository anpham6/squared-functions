import path = require('path');
import uuid = require('uuid');

import Module from '../module';

type ICloud = functions.ICloud;
type ExternalAsset = functions.ExternalAsset;
type CloudFeatures = functions.CloudFeatures;
type CloudFunctions = functions.CloudFunctions;

type CloudService = functions.squared.CloudService;
type CloudStorage = functions.squared.CloudStorage;
type CloudDatabase = functions.squared.CloudDatabase;
type CloudStorageAction = functions.squared.CloudStorageAction;
type CloudStorageUpload = functions.squared.CloudStorageUpload;
type CloudStorageDownload = functions.squared.CloudStorageDownload;

type CloudModule = functions.ExtendedSettings.CloudModule;

type ServiceClient = functions.internal.Cloud.ServiceClient;
type UploadHost = functions.internal.Cloud.UploadHost;
type UploadCallback = functions.internal.Cloud.UploadCallback;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadCallback = functions.internal.Cloud.DownloadCallback;
type CacheTimeout = functions.internal.Cloud.CacheTimeout;

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

class Cloud extends Module implements functions.ICloud {
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
        const length = storage.length;
        const filenameMap: ObjectMap<number> = {};
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
                                            if (!filenameMap[location]) {
                                                filenameMap[location] = 1;
                                            }
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
        const createHandler = (CLOUD_SERVICE[service] ||= require(`../cloud/${service}`) as ServiceClient).createBucket?.bind(this);
        if (createHandler) {
            return createHandler.call(this, credential, bucket, publicRead);
        }
        this.writeFail(['Create bucket function not supported', service]);
        return Promise.resolve(false);
    }
    deleteObjects(service: string, credential: PlainObject, bucket: string): Promise<void> {
        const deleteHandler = (CLOUD_SERVICE[service] ||= require(`../cloud/${service}`) as ServiceClient).deleteObjects?.bind(this);
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
            const credential = this.getCredential(data);
            const host = CLOUD_SERVICE[data.service];
            if (host.executeQuery) {
                return host.executeQuery.call(this, credential, data, cacheKey);
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
        const service = data.service;
        try {
            const client = CLOUD_SERVICE[service] ||= require(`../cloud/${service}`) as ServiceClient;
            const credential = this.getCredential(data);
            switch (feature) {
                case 'storage':
                    return typeof client.validateStorage === 'function' && client.validateStorage(credential, data);
                case 'database':
                    return typeof client.validateDatabase === 'function' && client.validateDatabase(credential, data);
            }
        }
        catch (err) {
            this.writeFail(['Cloud provider not found', service], err);
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