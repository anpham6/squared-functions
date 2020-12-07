import path = require('path');
import fs = require('fs');
import zlib = require('zlib');
import tinify = require('tinify');

import Module from '../module';

type FileManagerPerformAsyncTaskCallback = functions.FileManagerPerformAsyncTaskCallback;
type FileManagerCompleteAsyncTaskCallback = functions.FileManagerCompleteAsyncTaskCallback;
type CompressTryImageCallback = functions.CompressTryImageCallback;
type CompressTryFileMethod = functions.CompressTryFileMethod;

type CompressFormat = functions.squared.CompressFormat;

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
    tryImage(fileUri: string, callback: CompressTryImageCallback) {
        const failed = (err: Error) => this.writeFail(['Unable to compress image', path.basename(fileUri)], err);
        const ext = path.extname(fileUri).substring(1);
        this.formatMessage(this.logType.COMPRESS, ext, 'Compressing image...', fileUri, { titleColor: 'magenta' });
        const time = Date.now();
        fs.readFile(fileUri, (err, buffer) => {
            if (!err) {
                tinify.fromBuffer(buffer).toBuffer((err_r, data) => {
                    if (data && !err_r) {
                        fs.writeFile(fileUri, data, err_w => {
                            if (!err_w) {
                                callback(true);
                                this.writeTimeElapsed(ext, path.basename(fileUri), time);
                            }
                            else {
                                failed(err_w);
                                callback(false);
                            }
                        });
                    }
                    else {
                        if (err_r) {
                            failed(err_r);
                            this.validate(this.tinifyApiKey);
                        }
                        callback(false);
                    }
                });
            }
            else {
                failed(err);
                callback(false);
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