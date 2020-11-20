import type * as aws from 'aws-sdk';

import type { S3CloudCredential } from '../index';

type IFileManager = functions.IFileManager;

async function downloadS3(this: IFileManager, credential: S3CloudCredential, serviceName: string, Key: string, success: (value?: unknown) => void) {
    const Bucket = credential.bucket;
    if (Bucket) {
        try {
            const S3 = require('aws-sdk/clients/s3') as Constructor<aws.S3>;
            const s3 = new S3(credential);
            s3.getObject({ Bucket, Key }, (err, data) => {
                const Location = Bucket + ':' + Key;
                if (!err) {
                    this.writeMessage('Download success', Location, serviceName);
                    success(data.Body);
                }
                else {
                    this.writeFail(`Download failed [${serviceName}][${Location}]`, err);
                    success(null);
                }
            });
        }
        catch (err) {
            this.writeFail(`Install ${serviceName} SDK? [npm i aws-sdk]`, err);
            success(null);
        }
    }
    else {
        this.writeFail(`Bucket name not specified [${serviceName}][${Key}]`);
        success(null);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = downloadS3;
    module.exports.default = downloadS3;
    module.exports.__esModule = true;
}

export default downloadS3;