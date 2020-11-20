import type * as aws from 'aws-sdk';

import type { S3CloudCredential } from '../index';

type IFileManager = functions.IFileManager;

type DownloadHost = functions.internal.Cloud.DownloadHost;

async function downloadS3(this: IFileManager, service: string, credential: S3CloudCredential, Key: string, success: (value: Null<Buffer>) => void) {
    const Bucket = credential.bucket;
    if (Bucket) {
        try {
            const S3 = require('aws-sdk/clients/s3') as Constructor<aws.S3>;
            const s3 = new S3(credential);
            s3.getObject({ Bucket, Key }, (err, data) => {
                const Location = Bucket + ':' + Key;
                if (!err) {
                    this.writeMessage('Download success', Location, service);
                    success(data.Body as Buffer);
                }
                else {
                    this.writeFail(`Download failed [${service}][${Location}]`, err);
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
        this.writeFail(`Bucket not specified [${service}][bucket:${Key}]`);
        success(null);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = downloadS3;
    module.exports.default = downloadS3;
    module.exports.__esModule = true;
}

export default downloadS3 as DownloadHost;