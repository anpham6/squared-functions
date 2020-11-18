import type { GCSCloudService } from '../index';
import type * as gcs from '@google-cloud/storage';

import path = require('path');
import fs = require('fs');

type IFileManager = functions.IFileManager;

type CloudUploadOptions = functions.external.CloudUploadOptions;

function uploadHandlerGCS(this: IFileManager, config: GCSCloudService, serviceName: string) {
    let storage: gcs.Storage;
    try {
        const { Storage } = require('@google-cloud/storage');
        storage = new Storage(config);
    }
    catch (err) {
        this.writeFail('Install SDK? [npm i @google-cloud/storage]', serviceName);
        throw err;
    }
    return (buffer: Buffer, success: (value?: unknown) => void, options: CloudUploadOptions) => {
        if (path.basename(options.fileUri) !== options.filename) {
            options.fileUri = this.getTempDir() + options.filename;
            fs.writeFileSync(options.fileUri, buffer);
        }
        storage.bucket(config.bucket).upload(options.fileUri, { contentType: options.mimeType }, (err, result) => {
            if (err || !result) {
                this.writeFail(`${serviceName}: Upload failed (${options.fileUri})`, err);
                success('');
            }
            else {
                const url = config.apiEndpoint ? config.apiEndpoint.replace(/\/*$/, '') + '/' + options.filename : `https://storage.googleapis.com/${config.bucket}/${options.filename}`;
                this.writeMessage('Upload', url, serviceName);
                success(url);
            }
        });
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadHandlerGCS;
    module.exports.default = uploadHandlerGCS;
    module.exports.__esModule = true;
}

export default uploadHandlerGCS;