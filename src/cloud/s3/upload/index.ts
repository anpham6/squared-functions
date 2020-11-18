import type * as aws from 'aws-sdk';
import type * as awsCore from 'aws-sdk/lib/core';

import type { S3CloudService } from '../index';

type IFileManager = functions.IFileManager;

type CloudUploadOptions = functions.external.CloudUploadOptions;

function uploadHandlerS3(this: IFileManager, config: S3CloudService, serviceName: string) {
    let s3: aws.S3;
    try {
        const S3 = require('aws-sdk/clients/s3') as Constructor<aws.S3>;
        s3 = new S3(config as awsCore.ConfigurationOptions);
    }
    catch (err) {
        this.writeFail('Install SDK? [npm i aws-sdk]', serviceName);
        throw err;
    }
    return (buffer: Buffer, success: (value?: unknown) => void, options: CloudUploadOptions) => {
        s3.upload({ Bucket: config.bucket, Key: options.filename, Body: buffer, ContentType: options.mimeType }, (err, result) => {
            if (err) {
                this.writeFail(`${serviceName}: Upload failed (${options.fileUri})`, err);
                success('');
            }
            else {
                const url = config.apiEndpoint ? config.apiEndpoint.replace(/\/*$/, '') + '/' + options.filename : result.Location;
                this.writeMessage('Upload', url, serviceName);
                success(url);
            }
        });
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadHandlerS3;
    module.exports.default = uploadHandlerS3;
    module.exports.__esModule = true;
}

export default uploadHandlerS3;