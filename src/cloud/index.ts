import Module from '../module';

type CloudModule = functions.settings.CloudModule;

type CloudService = functions.squared.CloudService;

type CloudServiceClient = functions.external.CloudServiceClient;

const serviceMap: ObjectMap<CloudServiceClient> = {};

const Cloud = new class extends Module implements functions.ICloud {
    settings: CloudModule = {};

    getService(data: Undef<CloudService[]>) {
        if (data) {
            for (const item of data) {
                if (this.hasService(item)) {
                    if (item.active) {
                        return item;
                    }
                }
            }
        }
    }
    hasService(data: CloudService): data is CloudService {
        const cloud = this.settings || {};
        const service = data.service && data.service.trim();
        const settings = data.settings && cloud[service] ? cloud[service][data.settings] : {};
        try {
            return (serviceMap[service] ||= require(`../cloud/${service}`) as CloudServiceClient)({ ...settings, ...data });
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