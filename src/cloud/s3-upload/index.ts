import type * as aws from 'aws-sdk';
import type * as awsCore from 'aws-sdk/lib/core';

type IFileManager = functions.IFileManager;

type CloudUploadOptions = functions.external.CloudUploadOptions;

const uploadHandlerS3 = (manager: IFileManager, config: StandardMap) => {
    let s3: aws.S3;
    try {
        const S3 = require('aws-sdk/clients/s3') as Constructor<aws.S3>;
        s3 = new S3(config as awsCore.ConfigurationOptions);
    }
    catch (err) {
        manager.writeFail('Install SDK? [npm i aws-sdk]', 's3');
        throw err;
    }
    return (buffer: Buffer, success: (value?: unknown) => void, options: CloudUploadOptions) => {
        s3.upload({ Bucket: options.config.bucket as string, Key: options.filename, Body: buffer, ContentType: options.mimeType }, (err, result) => {
            if (err) {
                manager.writeFail(`s3: Upload failed (${options.fileUri})`, err);
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