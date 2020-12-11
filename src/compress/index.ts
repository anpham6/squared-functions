import type { CompressFormat } from '../types/lib/squared';

import path = require('path');
import fs = require('fs');
import zlib = require('zlib');
import tinify = require('tinify');

import Module from '../module';

type FileManagerPerformAsyncTaskCallback = functions.FileManagerPerformAsyncTaskCallback;
type FileManagerCompleteAsyncTaskCallback = functions.FileManagerCompleteAsyncTaskCallback;
type CompressTryImageCallback = functions.CompressTryImageCallback;
type CompressTryFileMethod = functions.CompressTryFileMethod;

function parseSizeRange(value: string): [number, number] {
    const match = /\(\s*(\d+)\s*,\s*(\d+|\*)\s*\)/.exec(value);
    return match ? [+match[1], match[2] === '*' ? Infinity : +match[2]] : [0, Infinity];
}

const Compress = new class extends Module implements functions.ICompress {
    public gzipLevel = 9;
    public brotliQuality = 11;
    public tinifyApiKey = '';
    public compressorProxy: ObjectMap<CompressTryFileMethod> = {};

    validate(value: Undef<string>) {
        if (value) {
            tinify.key = value;
            tinify.validate(err => {
                if (!err) {
                    this.tinifyApiKey = value;
                }
            });
        }
    }
    registerCompressor(format: string, callback: CompressTryFileMethod) {
        this.compressorProxy[format] = callback;
    }
    createWriteStreamAsGzip(source: string, fileUri: string, level?: number) {
        return fs.createReadStream(source)
            .pipe(zlib.createGzip({ level: level ?? this.gzipLevel }))
            .pipe(fs.createWriteStream(fileUri));
    }
    createWriteStreamAsBrotli(source: string, fileUri: string, quality?: number, mimeType = '') {
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
            .pipe(fs.createWriteStream(fileUri));
    }
    findFormat(compress: Undef<CompressFormat[]>, format: string) {
        return compress && compress.find(item => item.format === format);
    }
    hasImageService() {
        return this.tinifyApiKey !== '';
    }
    withinSizeRange(fileUri: string, value: Undef<string>) {
        if (value) {
            const [minSize, maxSize] = parseSizeRange(value);
            if (minSize > 0 || maxSize < Infinity) {
                const fileSize = Module.getFileSize(fileUri);
                if (fileSize === 0 || fileSize < minSize || fileSize > maxSize) {
                    return false;
                }
            }
        }
        return true;
    }
    tryFile(fileUri: string, data: CompressFormat, initialize?: Null<FileManagerPerformAsyncTaskCallback>, callback?: FileManagerCompleteAsyncTaskCallback) {
        if (this.withinSizeRange(fileUri, data.condition)) {
            switch (data.format) {
                case 'gz':
                case 'br': {
                    if (initialize) {
                        initialize();
                    }
                    const output = `${fileUri}.${data.format}`;
                    this.formatMessage(this.logType.COMPRESS, data.format, 'Compressing file...', output, { titleColor: 'magenta' });
                    const time = Date.now();
                    this[data.format === 'gz' ? 'createWriteStreamAsGzip' : 'createWriteStreamAsBrotli'](fileUri, output, data.level)
                        .on('finish', () => {
                            this.writeTimeElapsed(data.format, path.basename(output), time);
                            if (data.condition?.includes('%') && Module.getFileSize(output) >= Module.getFileSize(fileUri)) {
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
                        compressor.call(this, fileUri, data, initialize, callback);
                    }
                    else if (callback) {
                        callback();
                    }
                    break;
                }
            }
        }
    }
    tryImage(fileUri: string, data: CompressFormat, callback: CompressTryImageCallback) {
        const ext = path.extname(fileUri).substring(1);
        this.formatMessage(this.logType.COMPRESS, ext, ['Compressing image...', data.plugin || ''], fileUri, { titleColor: 'magenta' });
        const time = Date.now();
        const writeFail = (err: Null<Error>) => this.writeFail(['Unable to compress image', path.basename(fileUri)], err);
        const writeFile = (result: Buffer | Uint8Array) => {
            fs.writeFile(fileUri, result, err => {
                if (!err) {
                    callback(true);
                    this.writeTimeElapsed(ext, path.basename(fileUri), time);
                }
                else {
                    writeFail(err);
                    callback(false);
                }
            });
        };
        const tinifyService = Compress.hasImageService() && (!data.plugin || data.plugin === 'tinify') && (data.format === 'png' || data.format === 'jpeg');
        if (tinifyService || data.plugin) {
            fs.readFile(fileUri, async (err, buffer) => {
                if (!err) {
                    if (tinifyService) {
                        tinify.fromBuffer(buffer).toBuffer((error, result) => {
                            if (result && !error) {
                                writeFile(result);
                            }
                            else {
                                if (error) {
                                    writeFail(error);
                                    this.validate(this.tinifyApiKey);
                                }
                                callback(false);
                            }
                        });
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
        else {
            writeFail(null);
            callback(false);
        }
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Compress;
    module.exports.default = Compress;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Compress;