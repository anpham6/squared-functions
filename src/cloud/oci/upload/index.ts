import type { OCICloudCredentials } from '../index';

type IFileManager = functions.IFileManager;

type CloudServiceHost = functions.internal.Cloud.CloudServiceHost;
type CloudUploadCallback = functions.internal.Cloud.CloudUploadCallback;

function uploadOCI(this: IFileManager, credentials: OCICloudCredentials, serviceName: string): CloudUploadCallback {
    credentials.endpoint = `https://${credentials.namespace}.compat.objectstorage.${credentials.region}.oraclecloud.com`;
    credentials.s3ForcePathStyle = true;
    credentials.signatureVersion = 'v4';
    return (require('../../s3/upload') as CloudServiceHost).call(this, credentials, serviceName);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadOCI;
    module.exports.default = uploadOCI;
    module.exports.__esModule = true;
}

export default uploadOCI;