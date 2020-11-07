import fs = require('fs');
import zlib = require('zlib');

import Module from '../module';

type CompressFormat = functions.squared.base.CompressFormat;

const Compress = new class extends Module implements functions.ICompress {
    public gzipLevel = 9;
    public brotliQuality = 11;
    public tinifyApiKey = '';

    createWriteStreamAsGzip(source: string, filepath: string, level?: number) {
        return fs.createReadStream(source)
            .pipe(zlib.createGzip({ level: level ?? this.gzipLevel }))
            .pipe(fs.createWriteStream(filepath));
    }
    createWriteStreamAsBrotli(source: string, filepath: string, quality?: number, mimeType = '') {
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
            .pipe(fs.createWriteStream(filepath));
    }
    findFormat(compress: Undef<CompressFormat[]>, format: string) {
        return compress && compress.find(item => item.format === format);
    }
    removeFormat(compress: Undef<CompressFormat[]>, format: string) {
        if (compress) {
            const index = compress.findIndex(value => value.format === format);
            if (index !== -1) {
                compress.splice(index, 1);
            }
        }
    }
    findCompress(compress: Undef<CompressFormat[]>) {
        if (this.tinifyApiKey) {
            return this.findFormat(compress, 'png');
        }
    }
    parseSizeRange(value: string): [number, number] {
        const match = /\(\s*(\d+)\s*,\s*(\d+|\*)\s*\)/.exec(value);
        return match ? [+match[1], match[2] === '*' ? Infinity : +match[2]] : [0, Infinity];
    }
    withinSizeRange(filepath: string, value: Undef<string>) {
        if (value) {
            const [minSize, maxSize] = this.parseSizeRange(value);
            if (minSize > 0 || maxSize < Infinity) {
                const fileSize = this.getFileSize(filepath);
                if (fileSize === 0 || fileSize < minSize || fileSize > maxSize) {
                    return false;
                }
            }
        }
        return true;
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Compress;
    module.exports.default = Compress;
    module.exports.__esModule = true;
}

export default Compress;