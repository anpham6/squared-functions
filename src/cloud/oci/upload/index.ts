import type { IModule } from '../../../types/lib';

import type { UploadHost } from '../../index';

import { OCIStorageCredential, setStorageCredential } from '../index';

export default function upload(this: IModule, credential: OCIStorageCredential, service = 'oci') {
    setStorageCredential(credential);
    return (require('../../aws/upload') as UploadHost).call(this, credential, service);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = upload;
    module.exports.default = upload;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}