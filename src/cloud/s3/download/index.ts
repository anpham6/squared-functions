import type * as aws from 'aws-sdk';

import type { S3CloudCredential } from '../index';

type IFileManager = functions.IFileManager;
type CloudServiceDownload = functions.squared.CloudServiceDownload;
type DownloadHost = functions.internal.Cloud.DownloadHost;

async function download(this: IFileManager, service: string, credential: S3CloudCredential, data: CloudServiceDownload, success: (value: Null<Buffer>) => void) {
    const Bucket = credential.bucket;
    if (Bucket) {
        try {
            const S3 = require('aws-sdk/clients/s3') as Constructor<aws.S3>;
            const s3 = new S3(credential);
            const params = { Bucket, Key: data.filename, VersionId: data.versionId };
            s3.getObject(params, (err, { Body }) => {
                const location = Bucket + '/' + data.filename;
                if (!err) {
                    this.writeMessage('Download success', location, service);
                    success(Body as Buffer);
                    if (data.deleteStorage) {
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
        this.writeMessage('Bucket not specified', data.filename, service, 'red');
        success(null);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default download as DownloadHost;