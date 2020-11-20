import type { OCICloudCredential } from '../index';

type IFileManager = functions.IFileManager;

type ServiceHost = functions.internal.Cloud.ServiceHost;
type UploadCallback = functions.internal.Cloud.UploadCallback;

function uploadOCI(this: IFileManager, credential: OCICloudCredential, serviceName: string): UploadCallback {
    credential.endpoint = `https://${credential.namespace}.compat.objectstorage.${credential.region}.oraclecloud.com`;
    credential.s3ForcePathStyle = true;
    credential.signatureVersion = 'v4';
    return (require('../../s3/upload') as ServiceHost).call(this, credential, serviceName);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadOCI;
    module.exports.default = uploadOCI;
    module.exports.__esModule = true;
}

export default uploadOCI;