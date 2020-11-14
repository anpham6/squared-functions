import type { GCSCloudService } from '../gcs-client';
import type * as gcs from '@google-cloud/storage';

import path = require('path');
import fs = require('fs');

type IFileManager = functions.IFileManager;

type CloudUploadOptions = functions.external.CloudUploadOptions;

const uploadHandlerGCS = (manager: IFileManager, config: GCSCloudService) => {
    let storage: gcs.Storage;
    try {
        const { Storage } = require('@google-cloud/storage');
        storage = new Storage(config);
    }
    catch (err) {
        manager.writeFail('Install SDK? [npm i @google-cloud/storage]', 'GCS');
        throw err;
    }
    return (buffer: Buffer, success: (value?: unknown) => void, options: CloudUploadOptions) => {
        if (path.basename(options.fileUri) !== options.filename) {
            options.fileUri = manager.getTempDir() + options.filename;
            fs.writeFileSync(options.fileUri, buffer);
        }
        storage.bucket(config.bucket).upload(options.fileUri, { contentType: options.mimeType }, (err, result) => {
            if (err || !result) {
                manager.writeFail(`GCS: Upload failed (${options.fileUri})`, err);
                success('');
            }
            else {
                const url = config.apiEndpoint ? config.apiEndpoint.replace(/\/*$/, '') + '/' + options.filename : `https://storage.googleapis.com/${config.bucket}/${options.filename}`;
                manager.writeMessage('Upload', url, 'GCS');
                success(url);
            }
        });
    };
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadHandlerGCS;
    module.exports.default = uploadHandlerGCS;
    module.exports.__esModule = true;
}

export default uploadHandlerGCS;