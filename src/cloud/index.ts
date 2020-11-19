import Module from '../module';

type CloudFunctions = functions.CloudFunctions;

type CloudService = functions.squared.CloudService;
type CloudServiceAction = functions.squared.CloudServiceAction;
type CloudModule = functions.settings.CloudModule;

type CloudServiceClient = functions.internal.Cloud.CloudServiceClient;

const serviceMap: ObjectMap<CloudServiceClient> = {};

const Cloud = new class extends Module implements functions.ICloud {
    settings: CloudModule = {};

    getService(data: Undef<CloudService[]>, functionName: CloudFunctions) {
        if (data) {
            for (const item of data) {
                const service = this.hasService(item, functionName);
                if (service && service.active) {
                    return item;
                }
            }
        }
    }
    hasService(data: CloudService, functionName: CloudFunctions): CloudServiceAction | false {
        try {
            const action = data[functionName] as Undef<CloudServiceAction>;
            if (action) {
                const service = data.service.trim();
                const settings: PlainObject = data.settings && this.settings?.[service]?.[data.settings] || {};
                if ((serviceMap[service] ||= require(`../cloud/${service}`) as CloudServiceClient)({ ...settings, ...data })) {
                    return action;
                }
            }
        }
        catch {
        }
        return false;
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Cloud;
    module.exports.default = Cloud;
    module.exports.__esModule = true;
}

export default Cloud;