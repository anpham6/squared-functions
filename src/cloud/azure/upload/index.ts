import type { AzureStorageCredential } from '../index';

import path = require('path');
import uuid = require('uuid');

import { createBucket, createStorageClient } from '../index';

type IFileManager = functions.IFileManager;
type UploadHost = functions.internal.Cloud.UploadHost;
type UploadCallback = functions.internal.Cloud.UploadCallback;
type UploadData = functions.internal.Cloud.UploadData;

const BUCKET_MAP: ObjectMap<boolean> = {};

function upload(this: IFileManager, credential: AzureStorageCredential, service = 'azure'): UploadCallback {
    const blobServiceClient = createStorageClient.call(this, credential);
    return async (data: UploadData, success: (value: string) => void) => {
        const bucket = data.bucket ||= data.bucketGroup || uuid.v4();
        const fileUri = data.fileUri;
        const containerClient = blobServiceClient.getContainerClient(bucket);
        if (!BUCKET_MAP[bucket]) {
            const { active, publicRead } = data.upload;
            if (!await createBucket.call(this, credential, bucket, data.admin?.publicRead || publicRead || active && publicRead !== false)) {
                success('');
                return;
            }
            BUCKET_MAP[bucket] = true;
        }
        const pathname = data.upload?.pathname || '';
        let filename = data.filename;
        if (!filename || !data.upload.overwrite) {
            filename ||= path.basename(fileUri);
            try {
                const originalName = filename;
                const index = originalName.indexOf('.');
                let i = 0,
                    exists: Undef<boolean>;
                do {
                    if (i > 0) {
                        if (index !== -1) {
                            filename = originalName.substring(0, index) + `_${i}` + originalName.substring(index);
                        }
                        else {
                            filename = uuid.v4() + path.extname(fileUri);
                            break;
                        }
                    }
                    const name = pathname + filename;
                    exists = false;
                    for await (const blob of containerClient.listBlobsFlat({ includeUncommitedBlobs: true })) {
                        if (blob.name === name) {
                            exists = true;
                            break;
                        }
                    }
                }
                while (exists && ++i);
                if (i > 0) {
                    this.formatMessage(this.logType.CLOUD_STORAGE, service, 'File renamed', filename, { titleColor: 'yellow' });
                }
            }
            catch (err) {
                this.formatFail(this.logType.CLOUD_STORAGE, service, ['Unable to rename file', path.basename(fileUri)], err);
                success('');
                return;
            }
        }
        const Key = [filename];
        const Body = [data.buffer];
        const ContentType = [data.mimeType];
        const endpoint = data.upload.endpoint;
        for (const item of data.fileGroup) {
            Body.push(item[0] as Buffer);
            Key.push(filename + item[1]);
        }
        for (let i = 0; i < Key.length; ++i) {
            const blobName = pathname + Key[i];
            containerClient.getBlockBlobClient(blobName).upload(Body[i], Body[i].byteLength, { blobHTTPHeaders: { blobContentType: ContentType[i] } })
                .then(() => {
                    const url = this.joinPosix(endpoint ? endpoint : `https://${credential.accountName!}.blob.core.windows.net/${bucket}`, blobName);
                    this.formatMessage(this.logType.CLOUD_STORAGE, service, 'Upload success', url);
                    if (i === 0) {
                        success(url);
                    }
                })
                .catch(err => {
                    if (i === 0) {
                        this.formatFail(this.logType.CLOUD_STORAGE, service, ['Upload failed', Key[i]], err);
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