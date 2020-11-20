import type * as gcs from '@google-cloud/storage';

import type { GCSCloudCredential } from '../index';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;

type UploadOptions = functions.internal.Cloud.UploadOptions<GCSCloudCredential>;
type UploadCallback = functions.internal.Cloud.UploadCallback;

const BUCKET_MAP: ObjectMap<boolean> = {};

function uploadGCS(this: IFileManager, credential: GCSCloudCredential, serviceName: string): UploadCallback {
    let storage: gcs.Storage;
    try {
        const { Storage } = require('@google-cloud/storage');
        storage = new Storage(credential);
    }
    catch (err) {
        this.writeFail('Install SDK? [npm i @google-cloud/storage]', serviceName);
        throw err;
    }
    return async (buffer: Buffer, options: UploadOptions, success: (value?: unknown) => void) => {
        const { active, apiEndpoint, publicAccess } = options.upload;
        let bucketName = credential.bucket || uuid.v4();
        if (!BUCKET_MAP[bucketName]) {
            try {
                const [exists] = await storage.bucket(bucketName).exists();
                if (!exists) {
                    const keyFile = require(path.resolve(credential.keyFilename || credential.keyFile!));
                    storage.projectId = keyFile.project_id;
                    const [result] = await storage.createBucket(bucketName, credential);
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
        const fileUri = options.fileUri;
        let filename = options.filename;
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
        const Key = [filename];
        const Body: [Buffer, ...string[]] = [buffer];
        const ContentType = [options.mimeType];
        for (const item of options.fileGroup) {
            Body.push(item[0] as string);
            Key.push(filename + item[1]);
        }
        const renamed = path.basename(fileUri) !== filename;
        for (let i = 0; i < Key.length; ++i) {
            let sourceUri = i === 0 ? fileUri : Body[i] as string;
            if (renamed) {
                let tempDir = this.getTempDir() + uuid.v4() + path.sep;
                try {
                    fs.mkdirpSync(tempDir);
                }
                catch {
                    tempDir = this.getTempDir();
                }
                sourceUri = tempDir + Key[i];
                if (i === 0) {
                    try {
                        fs.writeFileSync(sourceUri, Body[0]);
                    }
                    catch (err) {
                        this.writeFail(`${serviceName}: Unable to write buffer (${fileUri})`, err);
                        success('');
                        return;
                    }
                }
                else {
                    try {
                        fs.copyFileSync(fileUri + path.extname(Key[i]), sourceUri);
                    }
                    catch (err) {
                        this.writeFail(`${serviceName}: Unable to copy file (${fileUri})`, err);
                    }
                }
            }
            bucket.upload(sourceUri, { contentType: ContentType[i] }, err => {
                if (!err) {
                    const url = (apiEndpoint ? apiEndpoint.replace(/\/+$/, '') : 'https://storage.googleapis.com/' + bucketName) + '/' + Key[i];
                    this.writeMessage('Upload success', url, serviceName);
                    if (i === 0) {
                        success(url);
                    }
                }
                else if (i === 0) {
                    this.writeFail(`${serviceName}: Upload failed (${fileUri})`, err);
                    success('');
                }
            });
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = uploadGCS;
    module.exports.default = uploadGCS;
    module.exports.__esModule = true;
}

export default uploadGCS;