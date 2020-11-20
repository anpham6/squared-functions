import type * as gcs from '@google-cloud/storage';

import type { GCSCloudCredential } from '../index';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;

type DownloadHost = functions.internal.Cloud.DownloadHost;

async function downloadGCS(this: IFileManager, service: string, credential: GCSCloudCredential, filename: string, success: (value: string) => void) {
    const bucket = credential.bucket;
    if (bucket) {
        try {
            const { Storage } = require('@google-cloud/storage');
            let tempDir = this.getTempDir() + uuid.v4() + path.sep;
            try {
                fs.mkdirpSync(tempDir);
            }
            catch {
                tempDir = this.getTempDir();
            }
            const location = bucket + ':' + filename;
            const destination = tempDir + filename;
            const storage = new Storage(credential) as gcs.Storage;
            storage
                .bucket(bucket)
                .file(filename)
                .download({ destination })
                .then(() => {
                    this.writeMessage('Download success', location, service);
                    success(destination);
                })
                .catch((err: Error) => {
                    this.writeMessage(`Download failed [${location}]`, err, service, 'red');
                    success('');
                });

        }
        catch (err) {
            this.writeFail(`Install ${service} SDK? [npm i @google-cloud/storage]`);
            throw err;
        }
    }
    else {
        this.writeMessage(`Container not specified`, filename, service, 'red');
        success('');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = downloadGCS;
    module.exports.default = downloadGCS;
    module.exports.__esModule = true;
}

export default downloadGCS as DownloadHost;