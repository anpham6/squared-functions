import type { GCSCloudCredential } from '../index';

import { createClient } from '../index';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadData = functions.internal.Cloud.DownloadData<GCSCloudCredential>;

async function download(this: IFileManager, service: string, credential: GCSCloudCredential, data: DownloadData, success: (value: string) => void) {
    const bucketName = data.service.bucket;
    if (bucketName) {
        try {
            const storage = createClient.call(this, service, credential);
            let tempDir = this.getTempDir() + uuid.v4() + path.sep;
            try {
                fs.mkdirpSync(tempDir);
            }
            catch {
                tempDir = this.getTempDir();
            }
            const filename = data.download.filename;
            const destination = tempDir + filename;
            const bucket = storage.bucket(bucketName);
            const file = bucket.file(filename, { generation: data.download.versionId });
            file.download({ destination })
                .then(() => {
                    const location = bucketName + '/' + filename;
                    this.formatMessage(service, 'Download success', location);
                    success(destination);
                    if (data.download.deleteStorage) {
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
        this.formatMessage(service, 'Container not specified', data.download.filename, 'red');
        success('');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default download as DownloadHost;