import type { Internal } from '../../../types/lib';
import type { GCloudStorageCredential } from '../index';

import fs = require('fs-extra');

import Module from '../../../module';

import { createStorageClient } from '../index';

type InstanceHost = Internal.Cloud.InstanceHost;
type DownloadData = Internal.Cloud.DownloadData;
type DownloadCallback = Internal.Cloud.DownloadCallback;

export default function download(this: InstanceHost, credential: GCloudStorageCredential, service = 'gcloud'): DownloadCallback {
    const storage = createStorageClient.call(this, credential);
    return async (data: DownloadData, success: (value: string) => void) => {
        const { bucket: Bucket, download: Download } = data;
        if (Bucket && Download && Download.filename) {
            try {
                let tempDir = this.getTempDir(true);
                try {
                    fs.mkdirpSync(tempDir);
                }
                catch {
                    tempDir = this.getTempDir();
                }
                const filename = Download.filename;
                const destination = tempDir + filename;
                const location = Module.joinPosix(Bucket, filename);
                const bucket = storage.bucket(Bucket);
                const file = bucket.file(filename, { generation: Download.versionId });
                file.download({ destination })
                    .then(() => {
                        this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Download success', location);
                        success(destination);
                        if (Download.deleteObject) {
                            file.delete({ ignoreNotFound: true }, err => {
                                if (!err) {
                                    this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Delete success', location, { titleColor: 'grey' });
                                }
                                else {
                                    this.formatFail(this.logType.CLOUD_STORAGE, service, ['Delete failed', location], err);
                                }
                            });
                        }
                    })
                    .catch((err: Error) => {
                        this.formatFail(this.logType.CLOUD_STORAGE, service, ['Download failed', location], err);
                        success('');
                    });
            }
            catch {
                success('');
            }
        }
        else {
            this.formatFail(this.logType.CLOUD_STORAGE, service, 'Container not specified', Download && Download.filename);
            success('');
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}