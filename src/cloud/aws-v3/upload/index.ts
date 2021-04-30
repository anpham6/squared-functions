import type { IModule } from '../../../types/lib';
import type { UploadData } from '../../../types/lib/cloud';

import type { UploadCallback } from '../../index';

import type * as s3 from '@aws-sdk/client-s3';

import path = require('path');
import uuid = require('uuid');

import Module from '../../../module';

import { AWSStorageConfig, createBucket } from '../index';

const BUCKET_MAP = new Map<string, Promise<boolean>>();

export default function upload(this: IModule, config: AWSStorageConfig, service = 'aws-v3', sdk = '@aws-sdk/client-s3'): UploadCallback {
    const AWS = require(sdk) as typeof s3;
    const client = new AWS.S3Client(config);
    return async (data: UploadData, success: (value: string) => void) => {
        const Bucket = data.bucket ||= data.bucketGroup || uuid.v4();
        const admin = data.admin;
        const bucketKey = service + (config.region || '') + Bucket;
        let promise = BUCKET_MAP.get(bucketKey);
        if (!promise) {
            BUCKET_MAP.set(bucketKey, promise = createBucket.call(this, config, Bucket, admin?.publicRead, service, sdk));
        }
        if (!await promise) {
            success('');
            return;
        }
        const localUri = data.localUri;
        const pathname = data.upload?.pathname || '';
        let filename = data.filename;
        const errorResponse = (err: any) => {
            BUCKET_MAP.delete(bucketKey);
            this.formatFail(this.logType.CLOUD, service, ['Upload failed', err.Code === 'PermanentRedirect' && err.Endpoint ? err.Endpoint : path.basename(localUri)], err);
            success('');
            return false;
        };
        if (!filename || !data.upload.overwrite) {
            filename ||= path.basename(localUri);
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
                            filename = uuid.v4() + path.extname(localUri);
                            break;
                        }
                    }
                    exists = await client.send(new AWS.HeadObjectCommand({ Bucket, Key: pathname + filename }))
                        .then(() => true)
                        .catch(err => {
                            if (err.message !== 'NotFound') {
                                filename = uuid.v4() + path.extname(localUri);
                            }
                            return false;
                        });
                }
                while (exists && ++i);
                if (i > 0) {
                    this.formatMessage(this.logType.CLOUD, service, 'File renamed', filename, { titleColor: 'yellow' });
                }
            }
            catch (err) {
                this.formatFail(this.logType.CLOUD, service, ['Unable to rename file', path.basename(localUri)], err);
                success('');
                return;
            }
        }
        if (pathname && !await client.send(new AWS.PutObjectCommand({ Bucket, Key: pathname, Body: Buffer.from(''), ContentLength: 0 })).then(() => true).catch(err => errorResponse(err))) {
            return;
        }
        const { active, publicRead, endpoint } = data.upload;
        const ACL = publicRead || active && publicRead !== false ? 'public-read' : '';
        const Key = [filename];
        const Body = [data.buffer];
        const ContentType = [data.mimeType];
        for (const item of data.fileGroup) {
            Body.push(item[0] as Buffer);
            Key.push(filename + item[1]);
        }
        for (let i = 0; i < Key.length; ++i) {
            const objectKey = pathname + Key[i];
            client.send(new AWS.PutObjectCommand({ Bucket, Key: objectKey, ACL, Body: Body[i], ContentType: ContentType[i] }))
                .then(() => {
                    const url = Module.joinPath(endpoint || `https://${Bucket}.s3.${config.region === 'us-east-1' ? 'us-east-1.' : ''}amazonaws.com`, objectKey);
                    if (i === 0) {
                        success(url);
                    }
                    this.formatMessage(this.logType.CLOUD, service, 'Upload success', url);
                })
                .catch(err => {
                    if (i === 0) {
                        errorResponse(err);
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