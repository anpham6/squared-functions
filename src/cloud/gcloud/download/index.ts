import type { GCloudStorageCredential } from '../index';

import { createStorageClient } from '../index';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');

type InstanceHost = functions.internal.Cloud.InstanceHost;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadData = functions.internal.Cloud.DownloadData;
type DownloadCallback = functions.internal.Cloud.DownloadCallback;

function download(this: InstanceHost, credential: GCloudStorageCredential, service = 'gcloud'): DownloadCallback {
    const storage = createStorageClient.call(this, credential);
    return async (data: DownloadData, success: (value: string) => void) => {
        const { bucket: Bucket, download: Download } = data;
        if (Bucket && Download && Download.filename) {
            try {
                let tempDir = this.getTempDir() + uuid.v4() + path.sep;
                try {
                    fs.mkdirpSync(tempDir);
                }
                catch {
                    tempDir = this.getTempDir();
                }
                const filename = Download.filename;
                const destination = tempDir + filename;
                const location = this.joinPosix(Bucket, filename);
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

export default download as DownloadHost;