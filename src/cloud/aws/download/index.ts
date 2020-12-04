import type * as aws from 'aws-sdk';

import type { AWSStorageCredential } from '../index';

import { createStorageClient } from '../index';

type IFileManager = functions.IFileManager;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadData = functions.internal.Cloud.DownloadData;
type DownloadCallback = functions.internal.Cloud.DownloadCallback;

function download(this: IFileManager, credential: AWSStorageCredential, service = 'aws', sdk = 'aws-sdk/clients/s3'): DownloadCallback {
    const s3 = createStorageClient.call(this, credential, service, sdk);
    return async (data: DownloadData, success: (value: Null<Buffer>) => void) => {
        const { bucket: Bucket, download: Download } = data;
        if (Bucket && Download && Download.filename) {
            try {
                const params: aws.S3.Types.GetObjectRequest = {
                    Bucket,
                    Key: Download.filename,
                    VersionId: Download.versionId
                };
                s3.getObject(params, (err, result) => {
                    const location = Bucket + '/' + Download.filename;
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

export default download as DownloadHost;