import type { AzureCloudCredential } from '../index';

import path = require('path');
import uuid = require('uuid');

import { createClient } from '../index';

type IFileManager = functions.IFileManager;
type UploadHost = functions.internal.Cloud.UploadHost;
type UploadCallback = functions.internal.Cloud.UploadCallback;
type UploadData = functions.internal.Cloud.UploadData;

const BUCKET_MAP: ObjectMap<boolean> = {};

function upload(this: IFileManager, credential: AzureCloudCredential, service: string): UploadCallback {
    const blobServiceClient = createClient.call(this, credential, service);
    return async (data: UploadData, success: (value: string) => void) => {
        const bucket = data.service.bucket ||= data.bucketGroup;
        const fileUri = data.fileUri;
        const containerClient = blobServiceClient.getContainerClient(bucket);
        if (!BUCKET_MAP[bucket]) {
            try {
                if (!await containerClient.exists()) {
                    const { active, publicRead } = data.upload;
                    await containerClient.create({ access: data.service.admin?.publicRead || publicRead || active && publicRead !== false ? 'blob' : 'container' });
                    this.formatMessage(service, 'Container created', bucket, 'blue');
                }
            }
            catch (err) {
                if (err.code !== 'ContainerAlreadyExists') {
                    this.formatMessage(service, ['Unable to create container', bucket], err, 'red');
                    success('');
                    return;
                }
            }
            BUCKET_MAP[bucket] = true;
        }
        const subFolder = data.service.admin?.subFolder || '';
        let filename = data.filename;
        if (!filename || !data.upload.overwrite) {
            filename ||= path.basename(fileUri);
            try {
                const originalName = filename;
                let exists: Undef<boolean>,
                    i = 0,
                    j = 0;
                do {
                    if (i > 0) {
                        j = originalName.indexOf('.');
                        if (j !== -1) {
                            filename = originalName.substring(0, j) + `_${i}` + originalName.substring(j);
                        }
                        else {
                            filename = uuid.v4() + path.extname(fileUri);
                            break;
                        }
                    }
                    const name = subFolder + filename;
                    for await (const blob of containerClient.listBlobsFlat({ includeUncommitedBlobs: true })) {
                        if (blob.name === name) {
                            exists = true;
                            break;
                        }
                    }
                }
                while (exists && ++i);
                if (i > 0) {
                    this.formatMessage(service, 'File renamed', filename, 'yellow');
                }
            }
            catch (err) {
                this.formatMessage(service, ['Unable to rename file', fileUri], err, 'red');
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
            const blobName = subFolder + Key[i];
            containerClient.getBlockBlobClient(blobName)
                .upload(Body[i], Body[i].byteLength, { blobHTTPHeaders: { blobContentType: ContentType[i] } })
                .then(() => {
                    const url = (endpoint ? this.toPosix(endpoint) : `https://${credential.accountName!}.blob.core.windows.net/${bucket}`) + '/' + blobName;
                    this.formatMessage(service, 'Upload success', url);
                    if (i === 0) {
                        success(url);
                    }
                })
                .catch(err => {
                    if (i === 0) {
                        this.formatMessage(service, ['Upload failed', Key[i]], err, 'red');
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