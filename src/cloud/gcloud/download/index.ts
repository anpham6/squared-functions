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
        const Key = Download && Download.filename;
        if (Bucket && Key) {
            try {
                let tempDir = this.getTempDir(true);
                try {
                    fs.mkdirpSync(tempDir);
                }
                catch {
                    tempDir = this.getTempDir();
                }
                const destination = tempDir + Key;
                const location = Module.joinPosix(Bucket, Key);
                const bucket = storage.bucket(Bucket);
                const file = bucket.file(Key, { generation: Download.versionId });
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
            catch (err) {
                this.formatFail(this.logType.CLOUD_STORAGE, service, 'Unknown', err);
                success('');
            }
        }
        else {
            const writeFail = (prop: string) => this.formatFail(this.logType.CLOUD_STORAGE, service, prop + ' not specified', new Error(`Missing property <${service}:${prop.toLowerCase()}>`));
            if (!Bucket) {
                writeFail('Bucket');
            }
            if (!Key) {
                writeFail('Filename');
            }
            success('');
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}