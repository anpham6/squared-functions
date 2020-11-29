import path = require('path');
import uuid = require('uuid');

import Module from '../module';

type ExternalAsset = functions.ExternalAsset;
type CloudFunctions = functions.CloudFunctions;
type CloudModule = functions.settings.CloudModule;
type CloudService = functions.squared.CloudService;
type CloudServiceAction = functions.squared.CloudServiceAction;
type CloudServiceUpload = functions.squared.CloudServiceUpload;
type ServiceClient = functions.internal.Cloud.ServiceClient;
type UploadHost = functions.internal.Cloud.UploadHost;
type UploadCallback = functions.internal.Cloud.UploadCallback;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadCallback = functions.internal.Cloud.DownloadCallback;

const CLOUD_SERVICE: ObjectMap<ServiceClient> = {};
const CLOUD_UPLOAD: ObjectMap<UploadHost> = {};
const CLOUD_DOWNLOAD: ObjectMap<DownloadHost> = {};

function setUploadFilename(upload: CloudServiceUpload, filename: string) {
    filename = Cloud.toPosix(filename.replace(/^\.*[\\/]+/, ''));
    const index = filename.lastIndexOf('/');
    if (index !== -1) {
        const directory = filename.substring(0, index + 1);
        upload.pathname = upload.pathname ? path.join(upload.pathname, directory) : directory;
        filename = filename.substring(index + 1);
    }
    return upload.filename = filename;
}

function hasSameBucket(provider: CloudService, other: CloudService) {
    const endpoint = provider.upload!.endpoint;
    return (provider.service && other.service || endpoint && endpoint === other.upload!.endpoint) && provider.bucket === other.bucket;
}

const assignFilename = (value: string) => uuid.v4() + (path.extname(value) || '');

const Cloud = new class extends Module implements functions.ICloud {
    settings: CloudModule = {};

    setObjectKeys(assets: ExternalAsset[]) {
        const storage: ExternalAsset[] = [];
        for (const item of assets) {
            if (item.cloudStorage) {
                for (const data of item.cloudStorage) {
                    const upload = data.upload;
                    if (upload) {
                        if (upload.filename) {
                            setUploadFilename(upload, upload.filename);
                        }
                        if (upload.pathname) {
                            upload.pathname = Cloud.toPosix(upload.pathname).replace(/^\/+/, '') + '/';
                        }
                        else if (data.admin?.preservePath && item.pathname) {
                            upload.pathname = Cloud.toPosix(path.join(item.moveTo || '', item.pathname)) + '/';
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
                        const trailingName = path.join(trailingFolder, filename);
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
                                            const leadingName = path.join(leadingFolder, leading.filename || previous.filename);
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
    downloadObject(credential: PlainObject, data: CloudService, callback: (value: Null<Buffer | string>) => void, bucketGroup?: string) {
        const downloadHandler = this.getDownloadHandler(credential, data.service);
        return new Promise<void>(resolve => {
            downloadHandler({ service: data, bucketGroup }, async (value: Null<Buffer | string>) => {
                await callback(value);
                resolve();
            });
        });
    }
    deleteObjects(credential: PlainObject, data: CloudService): Promise<void> {
        const { service, bucket } = data;
        if (service && bucket) {
            return (CLOUD_SERVICE[service] ||= require(`../cloud/${service}`) as ServiceClient).deleteObjects.call(this, credential, service.toUpperCase(), bucket);
        }
        return Promise.resolve();
    }
    getCredential(data: CloudService): PlainObject {
        return typeof data.credential === 'string' ? { ...this.settings[data.service] && this.settings[data.service][data.credential] } : { ...data.credential };
    }
    getService(action: CloudFunctions, data: Undef<CloudService[]>) {
        if (data) {
            for (const item of data) {
                const service = this.hasService(action, item);
                if (service && service.active) {
                    return item;
                }
            }
        }
    }
    hasService(action: CloudFunctions, data: CloudService): CloudServiceAction | false {
        switch (action) {
            case 'upload':
                break;
            case 'download':
                if (!data.bucket) {
                    return false;
                }
                break;
            default:
                return false;
        }
        const result = data[action];
        return result && this.hasCredential(data) ? result : false;
    }
    hasCredential(data: CloudService) {
        const service = data.service;
        try {
            return (CLOUD_SERVICE[service] ||= require(`../cloud/${service}`) as ServiceClient).validate(this.getCredential(data));
        }
        catch (err) {
            this.writeFail(['Cloud provider not found', service], err);
        }
        return false;
    }
    getUploadHandler(credential: PlainObject, service: string): UploadCallback {
        return (CLOUD_UPLOAD[service] ||= require(`../cloud/${service}/upload`) as UploadHost).call(this, credential, service.toUpperCase());
    }
    getDownloadHandler(credential: PlainObject, service: string): DownloadCallback {
        return (CLOUD_DOWNLOAD[service] ||= require(`../cloud/${service}/download`) as DownloadHost).call(this, credential, service.toUpperCase());
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Cloud;
    module.exports.default = Cloud;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Cloud;