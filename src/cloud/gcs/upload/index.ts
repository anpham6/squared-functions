import type * as gcs from '@google-cloud/storage';

import type { GCSCloudCredentials } from '../index';

import path = require('path');
import fs = require('fs');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;

type CloudUploadOptions = functions.internal.Cloud.CloudUploadOptions<GCSCloudCredentials>;
type CloudUploadCallback = functions.internal.Cloud.CloudUploadCallback;

const BUCKET_MAP: ObjectMap<boolean> = {};

function uploadGCS(this: IFileManager, credentials: GCSCloudCredentials, serviceName: string): CloudUploadCallback {
    let storage: gcs.Storage;
    try {
        const { Storage } = require('@google-cloud/storage');
        storage = new Storage(credentials);
    }
    catch (err) {
        this.writeFail('Install SDK? [npm i @google-cloud/storage]', serviceName);
        throw err;
    }
    return async (buffer: Buffer, options: CloudUploadOptions, success: (value?: unknown) => void) => {
        const { active, apiEndpoint, publicAccess } = options.upload;
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
            }
            catch (err) {
                if (err.code !== 409) {
                    this.writeFail(`${serviceName}: Unable to create bucket`, err);
                    success('');
                    return;
                }
            }
            BUCKET_MAP[bucketName] = true;
        }
        const bucket = storage.bucket(bucketName);
        let { fileUri, filename } = options;
        if (!filename) {
            filename = path.basename(fileUri);
            let exists = true;
            try {
                [exists] = await bucket.file(filename).exists();
            }
            catch {
            }
            if (exists) {
                this.writeMessage(`File renamed [${filename}]`, filename = uuid.v4() + path.extname(fileUri), serviceName, 'yellow');
            }
        }
        if (path.basename(fileUri) !== filename) {
            try {
                fs.writeFileSync(fileUri = this.getTempDir() + filename, buffer);
            }
            catch (err) {
                this.writeFail(`${serviceName}: Unable to write buffer (${fileUri})`, err);
                success('');
            }
        }
        bucket.upload(fileUri, { contentType: options.mimeType }, err => {
            if (!err) {
                const url = (apiEndpoint ? apiEndpoint.replace(/\/*$/, '') : 'https://storage.googleapis.com/' + bucketName) + '/' + filename;
                this.writeMessage('Upload success', url, serviceName);
                success(url);
            }
            else {
                this.writeFail(`${serviceName}: Upload failed (${fileUri})`, err);
                success('');
            }
        });
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadGCS;
    module.exports.default = uploadGCS;
    module.exports.__esModule = true;
}

export default uploadGCS;