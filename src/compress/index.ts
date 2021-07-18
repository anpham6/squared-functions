import type { CompressFormat, CompressLevel } from '../types/lib/squared';

import type { ICompress } from '../types/lib';
import type { CompressTryFileMethod } from '../types/lib/compress';
import type { CompleteAsyncTaskCallback } from '../types/lib/filemanager';

import { ERR_MESSAGE } from '../types/lib/logger';

import path = require('path');
import fs = require('fs');
import stream = require('stream');
import zlib = require('zlib');
import tinify = require('tinify');

import Module from '../module';

function writeError(this: Module, file: string, err?: Null<Error>, callback?: CompleteAsyncTaskCallback) {
    if (callback) {
        callback(err);
    }
    else if (err) {
        this.writeFail([ERR_MESSAGE.COMPRESS_FILE, file], err, this.logType.FILE);
    }
}

class BufferStream extends stream.Readable {
    constructor(public buffer: Null<Buffer>) {
        super();
    }
    _read() {
        this.push(this.buffer);
        this.buffer = null;
    }
}

const Compress = new class extends Module implements ICompress {
    moduleName = 'compress';
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
    getReadable(file: BufferOfURI) {
        if (file instanceof Buffer) {
            return this.supported(12, 3) || this.supported(10, 17, 0, true) ? stream.Readable.from(file) : new BufferStream(file);
        }
        return fs.createReadStream(file);
    }
    createWriteStreamAsGzip(file: BufferOfURI, output: string, options?: CompressLevel) {
        let level: Undef<number>,
            chunkSize: Undef<number>;
        if (options) {
            ({ level, chunkSize } = options);
        }
        return this.getReadable(file)
            .pipe(zlib.createGzip({ level: level ?? this.getLevel(output, zlib.constants.Z_DEFAULT_LEVEL), chunkSize: chunkSize ?? this.chunkSize }))
            .pipe(fs.createWriteStream(output));
    }
    createWriteStreamAsBrotli(file: BufferOfURI, output: string, options?: CompressLevel) {
        let level: Undef<number>,
            chunkSize: Undef<number>,
            mimeType: Undef<string>;
        if (options) {
            ({ level, chunkSize, mimeType } = options);
        }
        return this.getReadable(file)
            .pipe(
                zlib.createBrotliCompress({
                    params: {
                        [zlib.constants.BROTLI_PARAM_MODE]: mimeType?.includes('text/') ? zlib.constants.BROTLI_MODE_TEXT : zlib.constants.BROTLI_MODE_GENERIC,
                        [zlib.constants.BROTLI_PARAM_QUALITY]: level ?? this.getLevel(output, zlib.constants.BROTLI_DEFAULT_QUALITY) as number,
                        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: Module.getFileSize(file)
                    },
                    chunkSize: chunkSize ?? this.chunkSize
                })
            )
            .pipe(fs.createWriteStream(output));
    }
    tryFile(file: BufferOfURI, output: string, data: CompressFormat, callback?: CompleteAsyncTaskCallback<string>) {
        const format = data.format;
        switch (format) {
            case 'gz':
            case 'br': {
                this.formatMessage(this.logType.COMPRESS, format, 'Compressing file...', output, { titleColor: 'magenta' });
                const time = Date.now();
                this[format === 'gz' ? 'createWriteStreamAsGzip' : 'createWriteStreamAsBrotli'](file, output, data)
                    .on('finish', () => {
                        this.writeTimeProcess(format, path.basename(output), time);
                        if (callback) {
                            callback(null, output);
                        }
                    })
                    .on('error', err => {
                        this.writeTimeProcess(format, path.basename(output), time, { failed: true });
                        writeError.call(this, output, err, callback);
                    });
                break;
            }
            default: {
                const compressor = this.compressors[format]?.bind(this);
                if (typeof compressor === 'function') {
                    try {
                        compressor.call(this, file, output, data, callback);
                    }
                    catch (err) {
                        writeError.call(this, output, err, callback);
                    }
                }
                else if (callback) {
                    callback(new Error(`Unsupported format (${format})`));
                }
                break;
            }
        }
    }
    tryImage(uri: string, data: CompressFormat, callback?: CompleteAsyncTaskCallback<Buffer | Uint8Array>) {
        const { plugin, buffer } = data;
        const ext = path.extname(uri).substring(1);
        const writeFile = (result: Buffer | Uint8Array) => {
            let failed: Undef<boolean>;
            try {
                fs.writeFileSync(uri, result);
                if (callback) {
                    callback(null, result);
                }
            }
            catch (err) {
                failed = true;
                writeError.call(this, uri, err, callback);
            }
            this.writeTimeProcess(ext, path.basename(uri), time, { failed });
        };
        const loadBuffer = () => {
            try {
                tinify.fromBuffer(buffer || fs.readFileSync(uri)).toBuffer((err, result) => {
                    if (!err && result) {
                        writeFile(result);
                    }
                    else {
                        writeError.call(this, uri, err, callback);
                    }
                });
            }
            catch (err) {
                writeError.call(this, uri, err, callback);
            }
        };
        const writeUnsupported = (name: string) => writeError.call(this, uri, new Error(`Unsupported format (${name}: ${path.basename(uri)})`), callback);
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
                    writeUnsupported('tinify');
                    return;
                }
            }
            if (!apiKey) {
                writeError.call(this, uri, new Error('API key not found (tinify)'), callback);
            }
        }
        const time = Date.now();
        this.formatMessage(this.logType.COMPRESS, ext, ['Compressing image...', plugin], uri, { titleColor: 'magenta' });
        if (apiKey) {
            if (tinify['_key'] !== apiKey) {
                tinify.key = apiKey;
                tinify.validate(err => {
                    if (!err) {
                        loadBuffer();
                    }
                    else {
                        delete tinify['_key'];
                        writeError.call(this, uri, err, callback);
                    }
                });
            }
            else {
                loadBuffer();
            }
        }
        else if (plugin) {
            const checkResult = (output: Buffer, previous: Buffer) => {
                if (output !== previous) {
                    writeFile(output);
                }
                else {
                    writeUnsupported(plugin);
                }
            };
            const create = require(plugin) as FunctionType<FunctionType<Promise<Buffer>>>;
            if (buffer) {
                (async () => {
                    try {
                        checkResult(await create(data.options)(buffer), buffer);
                    }
                    catch (err) {
                        writeError.call(this, uri, err, callback);
                    }
                })();
            }
            else {
                fs.readFile(uri, async (err, result) => {
                    if (!err) {
                        try {
                            checkResult(await create(data.options)(result), result);
                        }
                        catch (err_1) {
                            writeError.call(this, uri, err_1, callback);
                        }
                    }
                    else {
                        writeError.call(this, uri, err, callback);
                    }
                });
            }
        }
        else {
            writeError.call(this, uri, new Error('Missing plugin (image)'), callback);
        }
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Compress;
    module.exports.default = Compress;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Compress;