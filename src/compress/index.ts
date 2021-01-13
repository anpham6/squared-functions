import type { CompressTryFileMethod, CompressTryImageCallback, FileManagerCompleteAsyncTaskCallback, FileManagerPerformAsyncTaskMethod, ICompress } from '../types/lib';
import type { CompressFormat } from '../types/lib/squared';

import path = require('path');
import fs = require('fs');
import zlib = require('zlib');
import tinify = require('tinify');

import Module from '../module';

const Compress = new class extends Module implements ICompress {
    public gzipLevel = 9;
    public brotliQuality = 11;
    public compressorProxy: ObjectMap<CompressTryFileMethod> = {};

    register(format: string, callback: CompressTryFileMethod) {
        this.compressorProxy[format] = callback;
    }
    createWriteStreamAsGzip(source: string, uri: string, level?: number) {
        return fs.createReadStream(source)
            .pipe(zlib.createGzip({ level: level ?? this.gzipLevel }))
            .pipe(fs.createWriteStream(uri));
    }
    createWriteStreamAsBrotli(source: string, uri: string, quality?: number, mimeType = '') {
        return fs.createReadStream(source)
            .pipe(
                zlib.createBrotliCompress({
                    params: {
                        [zlib.constants.BROTLI_PARAM_MODE]: mimeType.includes('text/') ? zlib.constants.BROTLI_MODE_TEXT : zlib.constants.BROTLI_MODE_GENERIC,
                        [zlib.constants.BROTLI_PARAM_QUALITY]: quality ?? this.brotliQuality,
                        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: Module.getFileSize(source)
                    }
                })
            )
            .pipe(fs.createWriteStream(uri));
    }
    tryFile(uri: string, data: CompressFormat, performAsyncTask?: Null<FileManagerPerformAsyncTaskMethod>, callback?: FileManagerCompleteAsyncTaskCallback) {
        const { format, level } = data;
        switch (format) {
            case 'gz':
            case 'br': {
                if (performAsyncTask) {
                    performAsyncTask();
                }
                const output = uri + '.' + format;
                this.formatMessage(this.logType.COMPRESS, format, 'Compressing file...', output, { titleColor: 'magenta' });
                const time = Date.now();
                this[format === 'gz' ? 'createWriteStreamAsGzip' : 'createWriteStreamAsBrotli'](uri, output, level)
                    .on('finish', () => {
                        this.writeTimeElapsed(format, path.basename(output), time);
                        if (callback) {
                            callback(null, output);
                        }
                    })
                    .on('error', err => {
                        throw err;
                    });
                break;
            }
            default: {
                const compressor = this.compressorProxy[format]?.bind(this);
                if (typeof compressor === 'function') {
                    compressor.call(this, uri, data, performAsyncTask, callback);
                }
                else if (callback) {
                    callback();
                }
                break;
            }
        }
    }
    tryImage(uri: string, data: CompressFormat, callback: CompressTryImageCallback) {
        const ext = path.extname(uri).substring(1);
        const writeFile = (result: Buffer | Uint8Array) => {
            fs.writeFile(uri, result, err => {
                if (!err) {
                    this.writeTimeElapsed(ext, path.basename(uri), time);
                    callback(null);
                }
                else {
                    throw err;
                }
            });
        };
        const loadBuffer = (buffer: Buffer) => {
            tinify.fromBuffer(buffer).toBuffer((err, result) => {
                if (result && !err) {
                    writeFile(result);
                }
                else {
                    delete tinify['_key'];
                    if (err) {
                        throw err;
                    }
                }
            });
        };
        let apiKey: Undef<string>;
        if ((data.plugin ||= 'tinify') === 'tinify') {
            if (data.options && (data.format === 'png' || data.format === 'jpeg')) {
                apiKey = data.options.apiKey as Undef<string>;
            }
            if (!apiKey) {
                throw new Error('Tinify API key not found');
            }
        }
        this.formatMessage(this.logType.COMPRESS, ext, ['Compressing image...', data.plugin], uri, { titleColor: 'magenta' });
        const time = Date.now();
        fs.readFile(uri, async (err, buffer) => {
            if (!err) {
                if (apiKey) {
                    if (tinify['_key'] !== apiKey) {
                        tinify.key = apiKey;
                        tinify.validate(error => {
                            if (!error) {
                                loadBuffer(buffer);
                            }
                            else {
                                throw error;
                            }
                        });
                    }
                    else {
                        loadBuffer(buffer);
                    }
                }
                else if (data.plugin) {
                    const plugin = require(data.plugin);
                    writeFile(await plugin(data.options)(buffer));
                }
                else {
                    throw new Error('Plugin not found');
                }
            }
            else {
                throw err;
            }
        });
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Compress;
    module.exports.default = Compress;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Compress;