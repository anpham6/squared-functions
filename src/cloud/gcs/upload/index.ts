import type * as gcs from '@google-cloud/storage';

import type { GCSCloudCredential } from '../index';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');

type IFileManager = functions.IFileManager;
type UploadData = functions.internal.Cloud.UploadData<GCSCloudCredential>;
type UploadCallback = functions.internal.Cloud.UploadCallback;
type UploadHost = functions.internal.Cloud.UploadHost;

const BUCKET_MAP: ObjectMap<boolean> = {};

function upload(this: IFileManager, service: string, credential: GCSCloudCredential): UploadCallback {
    let storage: gcs.Storage;
    try {
        const { Storage } = require('@google-cloud/storage');
        storage = new Storage(credential);
    }
    catch (err) {
        this.writeFail(`Install ${service} SDK? [npm i @google-cloud/storage]`);
        throw err;
    }
    return async (data: UploadData, success: (value: string) => void) => {
        if (!credential.bucket) {
            data.service.bucket = data.bucketGroup;
            credential.bucket = data.bucketGroup;
        }
        const { active, apiEndpoint, publicAccess } = data.upload;
        let bucketName = credential.bucket;
        if (!BUCKET_MAP[bucketName]) {
            try {
                const [exists] = await storage.bucket(bucketName).exists();
                if (!exists) {
                    const keyFile = require(path.resolve(credential.keyFilename || credential.keyFile!));
                    storage.projectId = keyFile.project_id;
                    const [result] = await storage.createBucket(bucketName, credential);
                    bucketName = result.name;
                    this.writeMessage('Bucket created', bucketName, service, 'blue');
                    if (publicAccess || active && publicAccess !== false) {
                        await result.acl.default
                            .add({ entity: 'allUsers', role: 'READER' })
                            .catch(err => this.writeMessage(`Unable to give public access [${bucketName}]`, err, service, 'yellow'));
                    }
                }
            }
            catch (err) {
                if (err.code !== 409) {
                    this.writeMessage(`Unable to create bucket [${bucketName}]`, err, service, 'red');
                    success('');
                    return;
                }
            }
            BUCKET_MAP[bucketName] = true;
        }
        const bucket = storage.bucket(bucketName);
        const fileUri = data.fileUri;
        let filename = data.filename;
        if (!filename) {
            filename = path.basename(fileUri);
            let exists = true;
            try {
                [exists] = await bucket.file(filename).exists();
            }
            catch {
            }
            if (exists) {
                this.writeMessage(`File renamed [${filename}]`, filename = uuid.v4() + path.extname(fileUri), service, 'yellow');
            }
        }
        const Key = [filename];
        const Body: [Buffer, ...string[]] = [data.buffer];
        const ContentType = [data.mimeType];
        for (const item of data.fileGroup) {
            Body.push(item[0] as string);
            Key.push(filename + item[1]);
        }
        for (let i = 0; i < Key.length; ++i) {
            const transformUri = fileUri + path.extname(Key[i]);
            let sourceUri = i === 0 ? fileUri : Body[i] as string;
            if (i === 0 || transformUri !== sourceUri) {
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
                        this.writeMessage(`Unable to write buffer [${fileUri}]`, err, service, 'red');
                        success('');
                        return;
                    }
                }
                else {
                    try {
                        fs.copyFileSync(transformUri, sourceUri);
                    }
                    catch (err) {
                        this.writeMessage(`Unable to copy file [${fileUri}]`, err, service, 'red');
                        success('');
                        return;
                    }
                }
            }
            bucket.upload(sourceUri, { contentType: ContentType[i] }, err => {
                if (!err) {
                    const url = (apiEndpoint ? this.toPosix(apiEndpoint) : 'https://storage.googleapis.com/' + bucketName) + '/' + Key[i];
                    this.writeMessage('Upload success', url, service);
                    if (i === 0) {
                        success(url);
                    }
                }
                else if (i === 0) {
                    this.writeMessage(`Upload failed [${sourceUri}]`, err, service, 'red');
                    success('');
                }
            });
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = upload;
    module.exports.default = upload;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default upload as UploadHost;