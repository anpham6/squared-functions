import type { CompressTryFileMethod, CompressTryImageCallback, FileManagerCompleteAsyncTaskCallback, FileManagerPerformAsyncTaskCallback, ICompress } from '../types/lib';
import type { CompressFormat } from '../types/lib/squared';

import path = require('path');
import fs = require('fs');
import zlib = require('zlib');
import tinify = require('tinify');

import Module from '../module';

function parseSizeRange(value: string): [number, number] {
    const match = /\(\s*(\d+)\s*,\s*(\d+|\*)\s*\)/.exec(value);
    return match ? [+match[1], match[2] === '*' ? Infinity : +match[2]] : [0, Infinity];
}

const Compress = new class extends Module implements ICompress {
    public gzipLevel = 9;
    public brotliQuality = 11;
    public compressorProxy: ObjectMap<CompressTryFileMethod> = {};

    register(format: string, callback: CompressTryFileMethod) {
        this.compressorProxy[format] = callback;
    }
    createWriteStreamAsGzip(source: string, localUri: string, level?: number) {
        return fs.createReadStream(source)
            .pipe(zlib.createGzip({ level: level ?? this.gzipLevel }))
            .pipe(fs.createWriteStream(localUri));
    }
    createWriteStreamAsBrotli(source: string, localUri: string, quality?: number, mimeType = '') {
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
            .pipe(fs.createWriteStream(localUri));
    }
    findFormat(compress: Undef<CompressFormat[]>, format: string) {
        return compress && compress.find(item => item.format === format);
    }
    withinSizeRange(localUri: string, value: Undef<string>) {
        if (value) {
            const [minSize, maxSize] = parseSizeRange(value);
            if (minSize > 0 || maxSize < Infinity) {
                const fileSize = Module.getFileSize(localUri);
                if (fileSize === 0 || fileSize < minSize || fileSize > maxSize) {
                    return false;
                }
            }
        }
        return true;
    }
    tryFile(localUri: string, data: CompressFormat, initialize?: Null<FileManagerPerformAsyncTaskCallback>, callback?: FileManagerCompleteAsyncTaskCallback) {
        if (this.withinSizeRange(localUri, data.condition)) {
            switch (data.format) {
                case 'gz':
                case 'br': {
                    if (initialize) {
                        initialize();
                    }
                    const output = `${localUri}.${data.format}`;
                    this.formatMessage(this.logType.COMPRESS, data.format, 'Compressing file...', output, { titleColor: 'magenta' });
                    const time = Date.now();
                    this[data.format === 'gz' ? 'createWriteStreamAsGzip' : 'createWriteStreamAsBrotli'](localUri, output, data.level)
                        .on('finish', () => {
                            this.writeTimeElapsed(data.format, path.basename(output), time);
                            if (data.condition?.includes('%') && Module.getFileSize(output) >= Module.getFileSize(localUri)) {
                                fs.unlink(output, () => {
                                    if (callback) {
                                        callback();
                                    }
                                });
                            }
                            else if (callback) {
                                callback(output);
                            }
                        })
                        .on('error', err => {
                            this.writeFail(['Unable to compress file', path.basename(output)], err);
                            if (callback) {
                                callback();
                            }
                        });
                    break;
                }
                default: {
                    const compressor = this.compressorProxy[data.format]?.bind(this);
                    if (typeof compressor === 'function') {
                        compressor.call(this, localUri, data, initialize, callback);
                    }
                    else if (callback) {
                        callback();
                    }
                    break;
                }
            }
        }
    }
    tryImage(localUri: string, data: CompressFormat, callback: CompressTryImageCallback) {
        const ext = path.extname(localUri).substring(1);
        const writeFail = (err: Null<Error>) => this.writeFail(['Unable to compress image', path.basename(localUri)], err);
        const writeFile = (result: Buffer | Uint8Array) => {
            fs.writeFile(localUri, result, err => {
                if (!err) {
                    callback(true);
                    this.writeTimeElapsed(ext, path.basename(localUri), time);
                }
                else {
                    writeFail(err);
                    callback(false);
                }
            });
        };
        const loadBuffer = (buffer: Buffer) => {
            tinify.fromBuffer(buffer).toBuffer((err, result) => {
                if (result && !err) {
                    writeFile(result);
                }
                else {
                    if (err) {
                        writeFail(err);
                    }
                    callback(false);
                    delete tinify['_key'];
                }
            });
        };
        let apiKey: Undef<string>;
        if ((data.plugin ||= 'tinify') === 'tinify') {
            if (data.options && (data.format === 'png' || data.format === 'jpeg')) {
                apiKey = data.options.apiKey as Undef<string>;
            }
            if (!apiKey) {
                writeFail(new Error('Tinify API key not found'));
                callback(false);
                return;
            }
        }
        this.formatMessage(this.logType.COMPRESS, ext, ['Compressing image...', data.plugin], localUri, { titleColor: 'magenta' });
        const time = Date.now();
        fs.readFile(localUri, async (err, buffer) => {
            if (!err) {
                if (apiKey) {
                    if (tinify['_key'] !== apiKey) {
                        tinify.key = apiKey;
                        tinify.validate(error => {
                            if (!error) {
                                loadBuffer(buffer);
                            }
                            else {
                                writeFail(error);
                                callback(false);
                            }
                        });
                    }
                    else {
                        loadBuffer(buffer);
                    }
                    return;
                }
                else if (data.plugin) {
                    try {
                        const plugin = require(data.plugin);
                        writeFile(await plugin(data.options)(buffer));
                        return;
                    }
                    catch (error) {
                        err = error;
                    }
                }
            }
            writeFail(err);
            callback(false);
        });
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Compress;
    module.exports.default = Compress;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Compress;