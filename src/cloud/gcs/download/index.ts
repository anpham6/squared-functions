import type * as gcs from '@google-cloud/storage';

import type { GCSCloudCredential } from '../index';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;
type CloudServiceDownload = functions.squared.CloudServiceDownload;
type DownloadHost = functions.internal.Cloud.DownloadHost;

async function download(this: IFileManager, service: string, credential: GCSCloudCredential, data: CloudServiceDownload, success: (value: string) => void) {
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
            const filename = data.filename;
            const destination = tempDir + filename;
            const storage = new Storage(credential) as gcs.Storage;
            const file = storage.bucket(bucket).file(filename, { generation: data.versionId });
            file.download({ destination })
                .then(() => {
                    const location = bucket + '/' + filename;
                    this.writeMessage('Download success', location, service);
                    success(destination);
                    if (data.deleteStorage) {
                        file.delete({ ignoreNotFound: true }, err => {
                            if (!err) {
                                this.writeMessage('Delete success', location, service, 'grey');
                            }
                            else {
                                this.writeMessage(`Delete failed [${location}]`, err, service, 'red');
                            }
                        });
                    }
                })
                .catch((err: Error) => {
                    this.writeMessage('Download failed', err, service, 'red');
                    success('');
                });

        }
        catch (err) {
            this.writeFail(`Install ${service} SDK? [npm i @google-cloud/storage]`);
            throw err;
        }
    }
    else {
        this.writeMessage(`Container not specified`, data.filename, service, 'red');
        success('');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default download as DownloadHost;