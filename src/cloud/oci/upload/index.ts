import type { OCICloudCredentials } from '../index';

type IFileManager = functions.IFileManager;

function uploadHandlerOCI(this: IFileManager, credentials: OCICloudCredentials, serviceName: string) {
    credentials.endpoint = `https://${credentials.namespace}.compat.objectstorage.${credentials.region}.oraclecloud.com`;
    credentials.s3ForcePathStyle = true;
    credentials.signatureVersion = 'v4';
    return require('../../s3/upload').call(this, credentials, serviceName);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadHandlerOCI;
    module.exports.default = uploadHandlerOCI;
    module.exports.__esModule = true;
}

export default uploadHandlerOCI;