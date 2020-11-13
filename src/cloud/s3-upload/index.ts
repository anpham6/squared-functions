import type * as aws from 'aws-sdk';
import type * as awsCore from 'aws-sdk/lib/core';

import path = require('path');
import uuid = require('uuid');

import S3 = require('aws-sdk/clients/s3');

type IFileManager = functions.IFileManager;

type CloudUploadOptions = functions.external.CloudUploadOptions;

const uploadHandlerS3 = (manager: IFileManager, config: StandardMap) => {
    let s3: aws.S3;
    try {
        s3 = new S3(config as awsCore.ConfigurationOptions);
    }
    catch (err) {
        manager.writeFail('Install AWS? [npm i aws-sdk]', 's3');
        throw err;
    }
    return (buffer: Buffer, success: (value?: unknown) => void, options: CloudUploadOptions) => {
        const Key = options.fileIndex === 0 && options.service.filename || (uuid.v4() + path.extname(options.fileUri));
        s3.upload({ Bucket: options.service.bucket, Key, Body: buffer, ContentType: options.mimeType }, (error, result) => {
            if (error) {
                manager.writeFail(`s3: Upload failed (${options.fileUri})`, error);
                success('');
            }
            else {
                manager.writeMessage('Upload', result.Location, 's3');
                success(result.Location);
            }
        });
    };
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadHandlerS3;
    module.exports.default = uploadHandlerS3;
    module.exports.__esModule = true;
}

export default uploadHandlerS3;