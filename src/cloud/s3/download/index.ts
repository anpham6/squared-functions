import type * as aws from 'aws-sdk';

import type { S3CloudCredential } from '../index';

import { createClient } from '../index';

type IFileManager = functions.IFileManager;
type DownloadHost = functions.internal.Cloud.DownloadHost;
type DownloadData = functions.internal.Cloud.DownloadData;
type DownloadCallback = functions.internal.Cloud.DownloadCallback;

function download(this: IFileManager, credential: S3CloudCredential, service: string, sdk = 'aws-sdk/clients/s3'): DownloadCallback {
    const s3 = createClient.call(this, credential, service, sdk);
    return async (data: DownloadData, success: (value: Null<Buffer>) => void) => {
        const { bucket: Bucket, download: Download } = data.service;
        if (Bucket && Download) {
            try {
                const params: aws.S3.Types.GetObjectRequest = {
                    Bucket,
                    Key: Download.filename,
                    VersionId: Download.versionId
                };
                s3.getObject(params, (err, result) => {
                    const location = Bucket + '/' + Download.filename;
                    if (!err) {
                        this.formatMessage(service, 'Download success', location);
                        success(result.Body as Buffer);
                        if (Download.deleteStorage) {
                            s3.deleteObject(params, error => {
                                if (!error) {
                                    this.formatMessage(service, 'Delete success', location, 'grey');
                                }
                                else {
                                    this.formatMessage(service, ['Delete failed', location], error, 'red');
                                }
                            });
                        }
                    }
                    else {
                        this.formatMessage(service, ['Download failed', location], err, 'red');
                        success(null);
                    }
                });
            }
            catch {
                success(null);
            }
        }
        else {
            this.formatMessage(service, 'Bucket not specified', Download ? Download.filename : '', 'red');
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