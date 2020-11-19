import type { OCICloudCredentials } from '../index';

type IFileManager = functions.IFileManager;

type ServiceHost = functions.internal.Cloud.ServiceHost;
type UploadCallback = functions.internal.Cloud.UploadCallback;

function uploadOCI(this: IFileManager, credentials: OCICloudCredentials, serviceName: string): UploadCallback {
    credentials.endpoint = `https://${credentials.namespace}.compat.objectstorage.${credentials.region}.oraclecloud.com`;
    credentials.s3ForcePathStyle = true;
    credentials.signatureVersion = 'v4';
    return (require('../../s3/upload') as ServiceHost).call(this, credentials, serviceName);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadOCI;
    module.exports.default = uploadOCI;
    module.exports.__esModule = true;
}

export default uploadOCI;