import Module from '../module';

type CloudFunctions = functions.CloudFunctions;
type CloudModule = functions.settings.CloudModule;
type CloudService = functions.squared.CloudService;
type CloudServiceAction = functions.squared.CloudServiceAction;
type ServiceClient = functions.internal.Cloud.ServiceClient;

const serviceMap: ObjectMap<ServiceClient> = {};

const Cloud = new class extends Module implements functions.ICloud {
    settings: CloudModule = {};

    getBucket(data: CloudService) {
        let result: Undef<string>;
        switch (data.service) {
            case 'azure':
                result = data.container as Undef<string>;
                break;
            default:
                result = data.bucket as Undef<string>;
                break;
        }
        return result || '';
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
    hasService(functionName: CloudFunctions, data: CloudService): CloudServiceAction | false {
        const action = data[functionName] as Undef<CloudServiceAction>;
        return action && this.hasCredential(data) ? action : false;
    }
    hasCredential(data: CloudService) {
        const service = data.service;
        try {
            const settings: StringMap = data.credential.settings && this.settings?.[service]?.[data.credential.settings] || {};
            return (serviceMap[service] ||= require(`../cloud/${service}`) as ServiceClient).validate({ ...settings, ...data.credential });
        }
        catch (err) {
            this.writeFail(['Cloud provider not found', service], err);
        }
        return false;
    }
    async deleteObjects(service: string, credential: PlainObject, bucket: string): Promise<void> {
        try {
            return (serviceMap[service] ||= require(`../cloud/${service}`) as ServiceClient).deleteObjects.call(this, service.toUpperCase(), credential, bucket);
        }
        catch (err) {
            this.writeFail(['Cloud provider not found', service], err);
        }
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Cloud;
    module.exports.default = Cloud;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Cloud;