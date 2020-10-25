import fs = require('fs');
import zlib = require('zlib');

import Module from '../module';

export default new class extends Module implements functions.ICompress {
    public gzip_level = 9;
    public brotli_quality = 11;
    public jpeg_quality = 100;
    public tinify_api_key = '';

    createWriteStreamAsGzip(source: string, filepath: string, level?: number) {
        return fs.createReadStream(source)
            .pipe(zlib.createGzip({ level: level ?? this.gzip_level }))
            .pipe(fs.createWriteStream(filepath));
    }
    createWriteStreamAsBrotli(source: string, filepath: string, quality?: number, mimeType = '') {
        return fs.createReadStream(source)
            .pipe(
                zlib.createBrotliCompress({
                    params: {
                        [zlib.constants.BROTLI_PARAM_MODE]: mimeType.includes('text/') ? zlib.constants.BROTLI_MODE_TEXT : zlib.constants.BROTLI_MODE_GENERIC,
                        [zlib.constants.BROTLI_PARAM_QUALITY]: quality ?? this.brotli_quality,
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
        if (this.tinify_api_key) {
            return this.findFormat(compress, 'png');
        }
    }
    getSizeRange(value: string): [number, number] {
        const match = /\(\s*(\d+)\s*,\s*(\d+|\*)\s*\)/.exec(value);
        return match ? [parseInt(match[1]), match[2] === '*' ? Infinity : parseInt(match[2])] : [0, Infinity];
    }
    withinSizeRange(filepath: string, value: Undef<string>) {
        if (value) {
            const [largerThan, smallerThan] = this.getSizeRange(value);
            if (largerThan > 0 || smallerThan < Infinity) {
                const fileSize = this.getFileSize(filepath);
                if (fileSize === 0 || fileSize < largerThan || fileSize > smallerThan) {
                    return false;
                }
            }
        }
        return true;
    }
}();