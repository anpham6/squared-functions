import type { GCSStorageCredential } from '../index';

import { createStorageClient } from '../index';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadData = functions.internal.Cloud.DownloadData;
type DownloadCallback = functions.internal.Cloud.DownloadCallback;

function download(this: IFileManager, credential: GCSStorageCredential, service = 'GCS'): DownloadCallback {
    const storage = createStorageClient.call(this, credential);
    return async (data: DownloadData, success: (value: string) => void) => {
        const { bucket: Bucket, download: Download } = data.storage;
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
                const bucket = storage.bucket(Bucket);
                const file = bucket.file(filename, { generation: Download.versionId });
                file.download({ destination })
                    .then(() => {
                        const location = Bucket + '/' + filename;
                        this.formatMessage(service, 'Download success', location);
                        success(destination);
                        if (Download.deleteObject) {
                            file.delete({ ignoreNotFound: true }, err => {
                                if (!err) {
                                    this.formatMessage(service, 'Delete success', location, 'grey');
                                }
                                else {
                                    this.formatMessage(service, ['Delete failed', location], err, 'red');
                                }
                            });
                        }
                    })
                    .catch((err: Error) => {
                        this.formatMessage(service, 'Download failed', err, 'red');
                        success('');
                    });
            }
            catch {
                success('');
            }
        }
        else {
            this.formatMessage(service, 'Container not specified', Download && Download.filename, 'red');
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