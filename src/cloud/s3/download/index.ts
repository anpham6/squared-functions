import type * as aws from 'aws-sdk';

import type { S3CloudCredential } from '../index';

type IFileManager = functions.IFileManager;
type CloudServiceDownload = functions.squared.CloudServiceDownload;
type DownloadHost = functions.internal.Cloud.DownloadHost;

async function downloadS3(this: IFileManager, service: string, credential: S3CloudCredential, download: CloudServiceDownload, success: (value: Null<Buffer>) => void) {
    const Bucket = credential.bucket;
    if (Bucket) {
        try {
            const S3 = require('aws-sdk/clients/s3') as Constructor<aws.S3>;
            const s3 = new S3(credential);
            const params = { Bucket, Key: download.filename, VersionId: download.versionId };
            s3.getObject(params, (err, data) => {
                const location = Bucket + '/' + download.filename;
                if (!err) {
                    this.writeMessage('Download success', location, service);
                    success(data.Body as Buffer);
                    if (download.deleteStorage) {
                        s3.deleteObject(params, error => {
                            if (!error) {
                                this.writeMessage('Delete success', location, service, 'grey');
                            }
                            else {
                                this.writeMessage(`Delete failed [${location}]`, error, service, 'red');
                            }
                        });
                    }
                }
                else {
                    this.writeMessage(`Download failed [${location}]`, err, service, 'red');
                    success(null);
                }
            });
        }
        catch (err) {
            this.writeFail(`Install ${service} SDK? [npm i aws-sdk]`, err);
            success(null);
        }
    }
    else {
        this.writeMessage('Bucket not specified', download.filename, service, 'red');
        success(null);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = downloadS3;
    module.exports.default = downloadS3;
    module.exports.__esModule = true;
}

export default downloadS3 as DownloadHost;