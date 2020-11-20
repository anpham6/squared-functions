import type { OCICloudCredential } from '../index';

type IFileManager = functions.IFileManager;

type UploadHost = functions.internal.Cloud.UploadHost;

function uploadOCI(this: IFileManager, service: string, credential: OCICloudCredential) {
    credential.endpoint = `https://${credential.namespace}.compat.objectstorage.${credential.region}.oraclecloud.com`;
    credential.s3ForcePathStyle = true;
    credential.signatureVersion = 'v4';
    return (require('../../s3/upload') as UploadHost).call(this, service, credential);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadOCI;
    module.exports.default = uploadOCI;
    module.exports.__esModule = true;
}

export default uploadOCI as UploadHost;