import type * as gcs from '@google-cloud/storage';

import type { GCSCloudCredentials } from '../index';

import path = require('path');
import fs = require('fs');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;

type CloudUploadOptions = functions.external.CloudUploadOptions<GCSCloudCredentials>;

const BUCKET_MAP: ObjectMap<boolean> = {};

function uploadHandlerGCS(this: IFileManager, credentials: GCSCloudCredentials, serviceName: string) {
    let storage: gcs.Storage;
    try {
        const { Storage } = require('@google-cloud/storage');
        storage = new Storage(credentials);
    }
    catch (err) {
        this.writeFail('Install SDK? [npm i @google-cloud/storage]', serviceName);
        throw err;
    }
    return async (buffer: Buffer, success: (value?: unknown) => void, options: CloudUploadOptions) => {
        const { active, apiEndpoint, publicAccess } = options.config;
        let bucketName = credentials.bucket || uuid.v4();
        if (!BUCKET_MAP[bucketName]) {
            try {
                const [exists] = await storage.bucket(bucketName).exists();
                if (!exists) {
                    const keyFile = require(path.resolve(credentials.keyFilename || credentials.keyFile!));
                    storage.projectId = keyFile.project_id;
                    const [result] = await storage.createBucket(bucketName, credentials);
                    bucketName = result.name;
                    this.writeMessage('Bucket created', bucketName, serviceName, 'blue');
                    if (publicAccess || active && publicAccess !== false) {
                        await result.acl.default.add({ entity: 'allUsers', role: 'READER' }).catch(err => this.writeFail(`${serviceName}: Unable to give public access to bucket [${bucketName}]`, err));
                    }
                }
                BUCKET_MAP[bucketName] = true;
            }
            catch (err) {
                if (err.code !== 409) {
                    this.writeFail(`${serviceName}: Unable to create bucket`, err);
                    success('');
                    return;
                }
            }
        }
        if (path.basename(options.fileUri) !== options.filename) {
            options.fileUri = this.getTempDir() + options.filename;
            fs.writeFileSync(options.fileUri, buffer);
        }
        storage.bucket(bucketName).upload(options.fileUri, { contentType: options.mimeType }, err => {
            if (err) {
                this.writeFail(`${serviceName}: Upload failed (${options.fileUri})`, err);
                success('');
            }
            else {
                const url = (apiEndpoint ? apiEndpoint.replace(/\/*$/, '') : 'https://storage.googleapis.com/' + bucketName) + '/' + options.filename;
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