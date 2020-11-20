import Module from '../module';

type CloudFunctions = functions.CloudFunctions;

type CloudService = functions.squared.CloudService;
type CloudServiceAction = functions.squared.CloudServiceAction;
type CloudModule = functions.settings.CloudModule;

type ServiceClient = functions.internal.Cloud.ServiceClient;

const serviceMap: ObjectMap<ServiceClient> = {};

const Cloud = new class extends Module implements functions.ICloud {
    settings: CloudModule = {};

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
        if (action) {
            const service = data.service.trim();
            try {
                const settings: PlainObject = data.settings && this.settings?.[service]?.[data.settings] || {};
                if ((serviceMap[service] ||= require(`../cloud/${service}`) as ServiceClient)({ ...settings, ...data })) {
                    return action;
                }
            }
            catch (err) {
                this.writeFail(`Cloud provider not found [${service}]`, err);
            }
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