import type { IModule } from '../../../types/lib';
import type { DownloadData } from '../../../types/lib/cloud';

import type { DownloadCallback } from '../../index';

import type * as aws from 'aws-sdk';

import Module from '../../../module';

import { AWSStorageCredential, createStorageClient } from '../index';

export default function download(this: IModule, credential: AWSStorageCredential, service = 'aws', sdk = 'aws-sdk/clients/s3'): DownloadCallback {
    const s3 = createStorageClient.call(this, credential, service, sdk);
    return async (data: DownloadData, success: (value: Null<Buffer>) => void) => {
        const { bucket: Bucket, download: Download } = data;
        const Key = Download && Download.filename;
        if (Bucket && Key) {
            try {
                const location = Module.joinPosix(Bucket, Key);
                const params: aws.S3.Types.GetObjectRequest = { Bucket, Key, VersionId: Download.versionId };
                s3.getObject(params, (err, result) => {
                    if (!err) {
                        this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Download success', location);
                        success(result.Body as Buffer);
                        if (Download.deleteObject) {
                            s3.deleteObject(params, error => {
                                if (!error) {
                                    this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Delete success', location, { titleColor: 'grey' });
                                }
                                else {
                                    this.formatFail(this.logType.CLOUD_STORAGE, service, ['Delete failed', location], error);
                                }
                            });
                        }
                    }
                    else {
                        this.formatFail(this.logType.CLOUD_STORAGE, service, ['Download failed', location], err);
                        success(null);
                    }
                });
            }
            catch (err) {
                this.formatFail(this.logType.CLOUD_STORAGE, service, 'Unknown', err);
                success(null);
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
            success(null);
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}