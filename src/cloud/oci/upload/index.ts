import type { OCICloudService } from '../index';

type IFileManager = functions.IFileManager;

function uploadHandlerOCI(this: IFileManager, config: OCICloudService, serviceName: string) {
    config.endpoint = `https://${config.namespace}.compat.objectstorage.${config.region}.oraclecloud.com`;
    config.s3ForcePathStyle = true;
    config.signatureVersion = 'v4';
    return require('../../s3/upload').call(this, config, serviceName);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadHandlerOCI;
    module.exports.default = uploadHandlerOCI;
    module.exports.__esModule = true;
}

export default uploadHandlerOCI;