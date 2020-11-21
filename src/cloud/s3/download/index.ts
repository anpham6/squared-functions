import type * as aws from 'aws-sdk';

import type { S3CloudCredential } from '../index';

type IFileManager = functions.IFileManager;
type DownloadData = functions.internal.Cloud.DownloadData<S3CloudCredential>;
type DownloadHost = functions.internal.Cloud.DownloadHost;

async function download(this: IFileManager, service: string, credential: S3CloudCredential, data: DownloadData, success: (value: Null<Buffer>) => void) {
    const Bucket = credential.bucket;
    if (Bucket) {
        try {
            const S3 = require('aws-sdk/clients/s3') as Constructor<aws.S3>;
            const s3 = new S3(credential);
            const params = { Bucket, Key: data.download.filename, VersionId: data.download.versionId };
            s3.getObject(params, (err, result) => {
                const location = Bucket + '/' + data.download.filename;
                if (!err) {
                    this.writeMessage('Download success', location, service);
                    success(result.Body as Buffer);
                    if (data.download.deleteStorage) {
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
        this.writeMessage('Bucket not specified', data.download.filename, service, 'red');
        success(null);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default download as DownloadHost;