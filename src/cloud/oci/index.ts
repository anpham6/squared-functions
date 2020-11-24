import type { ConfigurationOptions } from 'aws-sdk/lib/core';

import { deleteObjects as deleteObjects_s3 } from '../s3';

type IFileManager = functions.IFileManager;
type ICloud = functions.ICloud;

export interface OCICloudCredential extends ConfigurationOptions {
    region: string;
    namespace: string;
    endpoint?: string;
}

export default function validate(credential: OCICloudCredential) {
    return !!(credential.region && credential.namespace && credential.accessKeyId && credential.secretAccessKey);
}

export function setCredential(this: IFileManager | ICloud, credential: OCICloudCredential) {
    credential.endpoint = `https://${credential.namespace}.compat.objectstorage.${credential.region}.oraclecloud.com`;
    credential.s3ForcePathStyle = true;
    credential.signatureVersion = 'v4';
}

export async function deleteObjects(this: ICloud, service: string, credential: OCICloudCredential, bucket: string) {
    setCredential.call(this, credential);
    return deleteObjects_s3.call(this, service, credential, bucket);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate, setCredential, deleteObjects };
    module.exports.default = validate;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}