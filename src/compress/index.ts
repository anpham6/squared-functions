import fs = require('fs');
import zlib = require('zlib');
import tinify = require('tinify');

import Module from '../module';

type CompressFormat = functions.squared.CompressFormat;

type FileCompressFormat = functions.FileCompressFormat;
type FileManagerPerformAsyncTaskCallback = functions.FileManagerPerformAsyncTaskCallback;
type FileManagerCompleteAsyncTaskCallback = functions.FileManagerCompleteAsyncTaskCallback;
type FileOutputCallback = functions.FileOutputCallback;

type FileData = functions.internal.FileData;

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
    tryFile(data: FileData, format: FileCompressFormat, preCompress?: FileManagerPerformAsyncTaskCallback, postWrite?: FileManagerCompleteAsyncTaskCallback) {
        const { file, fileUri } = data;
        const formatData = this.findFormat(file.compress, format);
        if (formatData && this.withinSizeRange(fileUri, formatData.condition)) {
            let output = `${fileUri}.${format}`,
                methodName: Undef<NodeBuiltInCompressionMethod>;
            switch (format) {
                case 'gz':
                    methodName = 'createWriteStreamAsGzip';
                    break;
                case 'br':
                    methodName = 'createWriteStreamAsBrotli';
                    break;
            }
            if (methodName) {
                if (preCompress) {
                    preCompress();
                }
                Compress[methodName](fileUri, output, formatData.level)
                    .on('finish', () => {
                        if (formatData.condition?.includes('%') && this.getFileSize(output) >= this.getFileSize(fileUri)) {
                            try {
                                fs.unlinkSync(output);
                            }
                            catch {
                            }
                            output = '';
                        }
                        if (postWrite) {
                            postWrite(output);
                        }
                    })
                    .on('error', error => {
                        this.writeFail(output, error);
                        if (postWrite) {
                            postWrite();
                        }
                    });
            }
        }
    }
    tryImage(data: FileData, callback: FileOutputCallback) {
        const fileUri = data.fileUri;
        try {
            tinify.fromBuffer(fs.readFileSync(fileUri)).toBuffer((err, resultData) => {
                if (!err && resultData) {
                    fs.writeFileSync(fileUri, resultData);
                }
                callback(fileUri, err);
            });
        }
        catch (err) {
            this.validate(this.tinifyApiKey);
            throw err;
        }
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Compress;
    module.exports.default = Compress;
    module.exports.__esModule = true;
}

export default Compress;