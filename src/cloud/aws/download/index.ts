import type { Internal } from '../../../types/lib';
import type { AWSStorageCredential } from '../index';
import type * as aws from 'aws-sdk';

import { createStorageClient } from '../index';

type InstanceHost = Internal.Cloud.InstanceHost;
type DownloadData = Internal.Cloud.DownloadData;
type DownloadCallback = Internal.Cloud.DownloadCallback;

export default function download(this: InstanceHost, credential: AWSStorageCredential, service = 'aws', sdk = 'aws-sdk/clients/s3'): DownloadCallback {
    const s3 = createStorageClient.call(this, credential, service, sdk);
    return async (data: DownloadData, success: (value: Null<Buffer>) => void) => {
        const { bucket: Bucket, download: Download } = data;
        if (Bucket && Download && Download.filename) {
            try {
                const location = this.joinPosix(Bucket, Download.filename);
                const params: aws.S3.Types.GetObjectRequest = {
                    Bucket,
                    Key: Download.filename,
                    VersionId: Download.versionId
                };
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
            catch {
                success(null);
            }
        }
        else {
            this.formatFail(this.logType.CLOUD_STORAGE, service, 'Bucket not specified', Download && Download.filename);
            success(null);
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}