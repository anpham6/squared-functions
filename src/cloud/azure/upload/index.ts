import type { AzureStorageCredential } from '../index';

import path = require('path');
import uuid = require('uuid');

import { createBucket, createStorageClient } from '../index';

type InstanceHost = functions.internal.Cloud.InstanceHost;
type UploadData = functions.internal.Cloud.UploadData;
type UploadCallback = functions.internal.Cloud.UploadCallback;

const BUCKET_MAP: ObjectMap<boolean> = {};

export default function upload(this: InstanceHost, credential: AzureStorageCredential, service = 'azure'): UploadCallback {
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
                let i = 0,
                    exists: Undef<boolean>,
                    basename: Undef<string>,
                    suffix: Undef<string>;
                do {
                    if (i > 0) {
                        if (i === 1) {
                            const index = filename.indexOf('.');
                            if (index !== -1) {
                                basename = filename.substring(0, index);
                                suffix = filename.substring(index);
                                const match = /^(.+?)_(\d+)$/.exec(basename);
                                if (match) {
                                    basename = match[1];
                                    i = parseInt(match[2]) + 1;
                                }
                            }
                        }
                        if (basename) {
                            filename = basename + `_${i}` + suffix;
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