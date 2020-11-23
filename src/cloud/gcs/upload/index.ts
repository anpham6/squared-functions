import type * as gcs from '@google-cloud/storage';

import type { GCSCloudBucket, GCSCloudCredential } from '../index';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');

import { createClient, setPublicRead } from '../index';

type IFileManager = functions.IFileManager;
type UploadCallback = functions.internal.Cloud.UploadCallback;
type UploadHost = functions.internal.Cloud.UploadHost;
type UploadData = functions.internal.Cloud.UploadData<GCSCloudCredential, GCSCloudBucket>;

const BUCKET_MAP: ObjectMap<boolean> = {};

function upload(this: IFileManager, service: string, credential: GCSCloudCredential): UploadCallback {
    const storage = createClient.call(this, service, credential);
    return async (data: UploadData, success: (value: string) => void) => {
        let bucketName = data.service.bucket ||= data.bucketGroup,
            bucket: Undef<gcs.Bucket>;
        if (!BUCKET_MAP[bucketName]) {
            try {
                const [exists] = await storage.bucket(bucketName).exists();
                if (!exists) {
                    const keyFile = require(path.resolve(credential.keyFilename || credential.keyFile!));
                    storage.projectId = keyFile.project_id;
                    [bucket] = await storage.createBucket(bucketName, credential);
                    bucketName = bucket.name;
                    this.formatMessage(service, 'Bucket created', bucketName, 'blue');
                    if (data.service.admin?.publicRead) {
                        bucket.makePublic().then(() => setPublicRead.call(this, bucket!.acl.default, bucketName, true));
                    }
                }
            }
            catch (err) {
                if (err.code !== 409) {
                    this.formatMessage(service, ['Unable to create bucket', bucketName], err, 'red');
                    success('');
                    return;
                }
            }
            BUCKET_MAP[bucketName] = true;
        }
        bucket ||= storage.bucket(bucketName);
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
                this.formatMessage(service, ['File renamed', filename], filename = uuid.v4() + path.extname(fileUri), 'yellow');
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
            const destUri = fileUri + path.extname(Key[i]);
            let srcUri = i === 0 ? fileUri : Body[i] as string;
            if (i === 0 || destUri !== srcUri) {
                let tempDir = this.getTempDir() + uuid.v4() + path.sep;
                try {
                    fs.mkdirpSync(tempDir);
                }
                catch {
                    tempDir = this.getTempDir();
                }
                srcUri = tempDir + Key[i];
                try {
                    if (i === 0) {
                        fs.writeFileSync(srcUri, Body[0]);
                    }
                    else {
                        fs.copyFileSync(destUri, srcUri);
                    }
                }
                catch (err) {
                    this.formatMessage(service, ['Unable to write buffer', fileUri], err, 'red');
                    success('');
                    return;
                }
            }
            bucket.upload(srcUri, { contentType: ContentType[i] }, (err, file) => {
                if (file) {
                    const { active, apiEndpoint, publicRead } = data.upload;
                    const url = (apiEndpoint ? this.toPosix(apiEndpoint) : 'https://storage.googleapis.com/' + bucketName) + '/' + Key[i];
                    this.formatMessage(service, 'Upload success', url);
                    if (i === 0) {
                        success(url);
                    }
                    if (publicRead || active && publicRead !== false) {
                        setPublicRead.call(this, file.acl, bucketName + '/' + Key[i], publicRead);
                    }
                }
                else if (i === 0) {
                    this.formatMessage(service, ['Upload failed', srcUri], err, 'red');
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