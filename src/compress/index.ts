import type { CompressFormat, CompressLevel } from '../types/lib/squared';

import type { ICompress } from '../types/lib';
import type { CompressTryFileMethod } from '../types/lib/compress';
import type { CompleteAsyncTaskCallback } from '../types/lib/filemanager';

import path = require('path');
import fs = require('fs');
import zlib = require('zlib');
import tinify = require('tinify');

import Module from '../module';

const Compress = new class extends Module implements ICompress {
    level: ObjectMap<number> = {
        gz: 9,
        br: 11
    };
    compressors: ObjectMap<CompressTryFileMethod> = {};
    chunkSize?: number;

    register(format: string, callback: CompressTryFileMethod, level?: number) {
        this.compressors[format = format.toLowerCase()] = callback;
        if (level !== undefined) {
            this.level[format] = level;
        }
    }
    getLevel(output: string, fallback?: number) {
        const result = this.level[path.extname(output).substring(1).toLowerCase()]!;
        return !isNaN(result) ? result : fallback;
    }
    createWriteStreamAsGzip(uri: string, output: string, options?: CompressLevel) {
        let level: Undef<number>,
            chunkSize: Undef<number>;
        if (options) {
            ({ level, chunkSize } = options);
        }
        return fs.createReadStream(uri)
            .pipe(zlib.createGzip({ level: level ?? this.getLevel(output, zlib.constants.Z_DEFAULT_LEVEL), chunkSize: chunkSize ?? this.chunkSize }))
            .pipe(fs.createWriteStream(output));
    }
    createWriteStreamAsBrotli(uri: string, output: string, options?: CompressLevel) {
        let level: Undef<number>,
            chunkSize: Undef<number>,
            mimeType: Undef<string>;
        if (options) {
            ({ level, chunkSize, mimeType } = options);
        }
        return fs.createReadStream(uri)
            .pipe(
                zlib.createBrotliCompress({
                    params: {
                        [zlib.constants.BROTLI_PARAM_MODE]: mimeType?.includes('text/') ? zlib.constants.BROTLI_MODE_TEXT : zlib.constants.BROTLI_MODE_GENERIC,
                        [zlib.constants.BROTLI_PARAM_QUALITY]: level ?? this.getLevel(output, zlib.constants.BROTLI_DEFAULT_QUALITY) as number,
                        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: Module.getFileSize(uri)
                    },
                    chunkSize: chunkSize ?? this.chunkSize
                })
            )
            .pipe(fs.createWriteStream(output));
    }
    tryFile(uri: string, output: string, data: CompressFormat, callback?: CompleteAsyncTaskCallback<string>) {
        const format = data.format;
        switch (format) {
            case 'gz':
            case 'br': {
                this.formatMessage(this.logType.COMPRESS, format, 'Compressing file...', output, { titleColor: 'magenta' });
                const time = Date.now();
                this[format === 'gz' ? 'createWriteStreamAsGzip' : 'createWriteStreamAsBrotli'](uri, output, data)
                    .on('finish', () => {
                        this.writeTimeElapsed(format, path.basename(output), time);
                        if (callback) {
                            callback(null, output);
                        }
                    })
                    .on('error', err => {
                        if (callback) {
                            callback(err);
                        }
                    });
                break;
            }
            default: {
                const compressor = this.compressors[format]?.bind(this);
                if (typeof compressor === 'function') {
                    compressor.call(this, uri, output, data, callback);
                }
                else if (callback) {
                    callback(new Error('Compressor not found'));
                }
                break;
            }
        }
    }
    tryImage(uri: string, data: CompressFormat, callback?: CompleteAsyncTaskCallback<Buffer | Uint8Array>) {
        const ext = path.extname(uri).substring(1);
        const time = Date.now();
        const writeError = (err?: Null<Error>) => {
            if (callback) {
                callback(err);
            }
            else if (err) {
                this.writeFail(['Unable to compress image', path.basename(uri)], err, this.logType.FILE);
            }
        };
        const writeFile = (result: Buffer | Uint8Array) => {
            try {
                fs.writeFileSync(uri, result);
                this.writeTimeElapsed(ext, path.basename(uri), time);
                if (callback) {
                    callback(null, result);
                }
            }
            catch (err) {
                writeError(err);
            }
        };
        const loadBuffer = () => {
            try {
                tinify.fromBuffer(fs.readFileSync(uri)).toBuffer((err, result) => {
                    if (!err && result) {
                        writeFile(result);
                    }
                    else {
                        writeError(err);
                    }
                });
            }
            catch (err) {
                writeError(err);
            }
        };
        let apiKey: Undef<string>;
        if ((data.plugin ||= 'tinify') === 'tinify') {
            if (data.options) {
                if (data.format === 'png' || data.format === 'jpeg') {
                    apiKey = data.options.apiKey as Undef<string>;
                }
                else {
                    if (callback) {
                        callback();
                    }
                    this.formatMessage(this.logType.COMPRESS, ext, ['Compression not supported', 'tinify:' + ext], uri, { titleColor: 'grey' });
                    return;
                }
            }
            if (!apiKey) {
                throw new Error('Tinify API key not found');
            }
        }
        this.formatMessage(this.logType.COMPRESS, ext, ['Compressing image...', data.plugin], uri, { titleColor: 'magenta' });
        if (apiKey) {
            if (tinify['_key'] !== apiKey) {
                tinify.key = apiKey;
                tinify.validate(err => {
                    if (!err) {
                        loadBuffer();
                    }
                    else {
                        delete tinify['_key'];
                        writeError(err);
                    }
                });
            }
            else {
                loadBuffer();
            }
        }
        else if (data.plugin) {
            const plugin = require(data.plugin);
            fs.readFile(uri, async (err, buffer) => {
                if (!err) {
                    try {
                        writeFile(await plugin(data.options)(buffer));
                    }
                    catch (err_1) {
                        writeError(err_1);
                    }
                }
                else {
                    writeError(err);
                }
            });
        }
        else {
            throw new Error('Plugin not found');
        }
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Compress;
    module.exports.default = Compress;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Compress;