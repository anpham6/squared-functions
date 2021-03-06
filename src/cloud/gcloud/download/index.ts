import type { IModule } from '../../../types/lib';
import type { DownloadData } from '../../../types/lib/cloud';

import type { DownloadCallback } from '../../index';

import { ERR_MESSAGE } from '../../../types/lib/logger';
import { ERR_CLOUD } from '../../index';

import Module from '../../../module';

import { GCloudStorageCredential, createStorageClient } from '../index';

export default function download(this: IModule, credential: GCloudStorageCredential, service = 'gcloud'): DownloadCallback {
    const storage = createStorageClient.call(this, credential);
    return async (data: DownloadData, success: (value: string) => void) => {
        const { bucket: Bucket, download: Download } = data;
        const Key = Download.filename;
        if (Bucket && Key) {
            try {
                let tempDir = this.getTempDir(true);
                if (!Module.mkdirSafe(tempDir, true)) {
                    tempDir = this.getTempDir();
                }
                const destination = tempDir + Key;
                const location = Module.joinPath(Bucket, Key);
                const bucket = storage.bucket(Bucket);
                const file = bucket.file(Key, { generation: Download.versionId });
                file.download({ destination })
                    .then(() => {
                        this.formatMessage(this.logType.CLOUD, service, 'Download success', location);
                        success(destination);
                        if (Download.deleteObject) {
                            file.delete({ ignoreNotFound: true }, err => {
                                if (!err) {
                                    this.formatMessage(this.logType.CLOUD, service, 'Delete success', location, { titleColor: 'grey' });
                                }
                                else {
                                    this.formatFail(this.logType.CLOUD, service, [ERR_CLOUD.DELETE_FAIL, location], err);
                                }
                            });
                        }
                    })
                    .catch((err: Error) => {
                        this.formatFail(this.logType.CLOUD, service, [ERR_CLOUD.DOWNLOAD_FAIL, location], err);
                        success('');
                    });
            }
            catch (err) {
                this.formatFail(this.logType.CLOUD, service, ERR_MESSAGE.UNKNOWN, err);
                success('');
            }
        }
        else {
            const writeFail = (prop: string) => this.formatFail(this.logType.CLOUD, service, prop + ' not specified', new Error(service + `: ${prop.toLowerCase()} (Missing property)`));
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