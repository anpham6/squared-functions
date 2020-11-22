import fs = require('fs');
import zlib = require('zlib');
import tinify = require('tinify');

import Module from '../module';

type FileManagerPerformAsyncTaskCallback = functions.FileManagerPerformAsyncTaskCallback;
type FileManagerCompleteAsyncTaskCallback = functions.FileManagerCompleteAsyncTaskCallback;
type FileOutputCallback = functions.FileOutputCallback;

type CompressFormat = functions.squared.CompressFormat;

type NodeBuiltInCompressionMethod = "createWriteStreamAsGzip" | "createWriteStreamAsBrotli";

const Compress = new class extends Module implements functions.ICompress {
    public gzipLevel = 9;
    public brotliQuality = 11;
    public tinifyApiKey = '';

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
                        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: this.getFileSize(source)
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
    parseSizeRange(value: string): [number, number] {
        const match = /\(\s*(\d+)\s*,\s*(\d+|\*)\s*\)/.exec(value);
        return match ? [+match[1], match[2] === '*' ? Infinity : +match[2]] : [0, Infinity];
    }
    withinSizeRange(fileUri: string, value: Undef<string>) {
        if (value) {
            const [minSize, maxSize] = this.parseSizeRange(value);
            if (minSize > 0 || maxSize < Infinity) {
                const fileSize = this.getFileSize(fileUri);
                if (fileSize === 0 || fileSize < minSize || fileSize > maxSize) {
                    return false;
                }
            }
        }
        return true;
    }
    tryFile(fileUri: string, data: CompressFormat, initialize?: FileManagerPerformAsyncTaskCallback, callback?: FileManagerCompleteAsyncTaskCallback) {
        if (this.withinSizeRange(fileUri, data.condition)) {
            const output = `${fileUri}.${data.format}`;
            let methodName: Undef<NodeBuiltInCompressionMethod>;
            switch (data.format) {
                case 'gz':
                    methodName = 'createWriteStreamAsGzip';
                    break;
                case 'br':
                    methodName = 'createWriteStreamAsBrotli';
                    break;
            }
            if (methodName) {
                if (initialize) {
                    initialize();
                }
                Compress[methodName](fileUri, output, data.level)
                    .on('finish', () => {
                        if (data.condition?.includes('%') && this.getFileSize(output) >= this.getFileSize(fileUri)) {
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
                        this.writeFail(['Unable to compress file', output], err);
                        if (callback) {
                            callback();
                        }
                    });
                return;
            }
        }
        if (!initialize && callback) {
            callback();
        }
    }
    tryImage(fileUri: string, callback: FileOutputCallback) {
        fs.readFile(fileUri, (err, buffer) => {
            if (err) {
                callback('', err);
            }
            else {
                tinify.fromBuffer(buffer).toBuffer((errR, data) => {
                    if (data && !errR) {
                        fs.writeFile(fileUri, data, errW => callback(errW ? '' : fileUri, errW));
                    }
                    else {
                        if (errR) {
                            this.validate(this.tinifyApiKey);
                        }
                        callback('', errR);
                    }
                });
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