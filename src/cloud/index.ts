import path = require('path');
import uuid = require('uuid');

import Module from '../module';

type ExternalAsset = functions.ExternalAsset;
type CloudFunctions = functions.CloudFunctions;
type CloudModule = functions.settings.CloudModule;
type CloudService = functions.squared.CloudService;
type CloudServiceAction = functions.squared.CloudServiceAction;
type ServiceClient = functions.internal.Cloud.ServiceClient;
type CloudServiceUpload = functions.internal.Cloud.CloudServiceUpload;

const serviceMap: ObjectMap<ServiceClient> = {};

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
    async deleteObjects(credential: PlainObject, service: string, bucket: string): Promise<void> {
        try {
            return (serviceMap[service] ||= require(`../cloud/${service}`) as ServiceClient).deleteObjects.call(this, credential, service.toUpperCase(), bucket);
        }
        catch (err) {
            this.writeFail(['Cloud provider not found', service], err);
        }
    }
    getService(functionName: CloudFunctions, data: Undef<CloudService[]>) {
        if (data) {
            for (const item of data) {
                const service = this.hasService(functionName, item);
                if (service && service.active) {
                    return item;
                }
            }
        }
    }
    getCredential(data: CloudService): PlainObject {
        return typeof data.credential === 'string' ? { ...this.settings[data.service] && this.settings[data.service][data.credential] } : { ...data.credential };
    }
    hasService(functionName: CloudFunctions, data: CloudService): CloudServiceAction | false {
        switch (functionName) {
            case 'download':
                if (!data.bucket) {
                    return false;
                }
                break;
        }
        const action = data[functionName] as Undef<CloudServiceAction>;
        return action && this.hasCredential(data) ? action : false;
    }
    hasCredential(data: CloudService) {
        const service = data.service;
        try {
            return (serviceMap[service] ||= require(`../cloud/${service}`) as ServiceClient).validate(this.getCredential(data));
        }
        catch (err) {
            this.writeFail(['Cloud provider not found', service], err);
        }
        return false;
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Cloud;
    module.exports.default = Cloud;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Cloud;