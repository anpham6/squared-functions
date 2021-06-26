import type { Readable } from 'stream';

import type { IModule } from '../../../types/lib';
import type { DownloadData } from '../../../types/lib/cloud';

import type { DownloadCallback } from '../../index';

import type * as s3 from '@aws-sdk/client-s3';

import Module from '../../../module';

import { AWSStorageConfig } from '../index';

async function readableAsBuffer(stream: Readable) {
    return new Promise<Null<Buffer>>(resolve => {
        let result: Null<Buffer> = null;
        stream.on('data', buffer => {
            result = result ? Buffer.concat([result, buffer]) : buffer;
        });
        stream.on('end', () => resolve(result));
        stream.on('error', () => resolve(null));
        stream.read();
    });
}

export default function download(this: IModule, config: AWSStorageConfig, service = 'aws-v3', sdk = '@aws-sdk/client-s3'): DownloadCallback {
    const AWS = require(sdk) as typeof s3;
    return async (data: DownloadData, success: (value: Null<Buffer>) => void) => {
        const { bucket: Bucket, download: Download } = data;
        const Key = Download.filename;
        if (Bucket && Key) {
            const location = Module.joinPath(Bucket, Key);
            const input: s3.GetObjectRequest = { Bucket, Key, VersionId: Download.versionId };
            const complete = (err: Null<Error>, buffer: Null<Buffer> = null) => {
                if (err || !buffer) {
                    this.formatFail(this.logType.CLOUD, service, ['Download failed', location], err);
                }
                success(buffer);
            };
            try {
                const client = new AWS.S3Client(config);
                client.send(new AWS.GetObjectCommand(input))
                    .then(async result => {
                        this.formatMessage(this.logType.CLOUD, service, 'Download success', location);
                        complete(null, await readableAsBuffer(result.Body as Readable));
                        if (Download.deleteObject) {
                            client.send(new AWS.DeleteObjectCommand(input))
                                .then(() => this.formatMessage(this.logType.CLOUD, service, 'Delete success', location, { titleColor: 'grey' }))
                                .catch(err => this.formatFail(this.logType.CLOUD, service, ['Delete failed', location], err));
                        }
                    })
                    .catch(err => complete(err));
            }
            catch (err) {
                complete(err);
            }
        }
        else {
            const writeFail = (prop: string) => this.formatFail(this.logType.CLOUD, service, prop + ' not specified', new Error(service + `: ${prop.toLowerCase()} (Missing property)`));
            if (!Bucket) {
                writeFail('Bucket');
            }
            if (!Key) {
                writeFail('Filename');
            }
            success(null);
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = download;
    module.exports.default = download;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}