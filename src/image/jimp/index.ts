import type { IFileManager } from '../../types/lib';
import type { FileData } from '../../types/lib/asset';
import type { FinalizeImageCallback } from '../../types/lib/filemanager';
import type { OutputData } from '../../types/lib/image';

import type { IJimpImageHandler } from './image';

import path = require('path');
import fs = require('fs');
import child_process = require('child_process');
import jimp = require('jimp');

import Image from '../index';

const MODULE_NAME = 'jimp';

function performCommand(localUri: string | Buffer, command: string, outputType: string, finalAs?: string, host?: IFileManager, data?: FileData) {
    return jimp.read(localUri as string)
        .then(async img => {
            const handler = new Jimp(img);
            handler.setCommand(command, finalAs);
            handler.method();
            handler.resize();
            handler.crop();
            if (outputType === jimp.MIME_JPEG && !finalAs) {
                handler.quality();
            }
            else {
                handler.opacity();
            }
            if (host && data && handler.rotateCount > 1) {
                await handler.rotate(host.getLocalUri(data), (err, result) => {
                    if (!err) {
                        host.add(result, data.file);
                    }
                });
            }
            else {
                handler.rotate();
            }
            return handler;
        });
}

const getBuffer = (data: FileData) => (data.file.buffer as unknown) as string || data.file.localUri!;

class Jimp extends Image implements IJimpImageHandler {
    public static MIME_INPUT = new Set([jimp.MIME_PNG, jimp.MIME_JPEG, jimp.MIME_BMP, jimp.MIME_GIF, jimp.MIME_TIFF, 'image/webp']);
    public static MIME_OUTPUT = new Set([jimp.MIME_PNG, jimp.MIME_JPEG, jimp.MIME_BMP, 'image/webp']);

    public static parseFormat(command: string, mimeType?: string): [string, string, string] {
        let [outputType, saveAs] = super.parseFormat(command),
            finalAs = '';
        if (outputType && saveAs) {
            switch (saveAs) {
                case 'jpeg':
                    saveAs = 'jpg';
                    break;
                case 'webp':
                    if (mimeType === jimp.MIME_JPEG) {
                        outputType = jimp.MIME_JPEG;
                        saveAs = 'jpg';
                    }
                    else {
                        outputType = jimp.MIME_PNG;
                        saveAs = 'png';
                    }
                    finalAs = 'webp';
                    break;
            }
        }
        return [outputType, saveAs, finalAs];
    }

    public static async transform(uri: string, command: string, mimeType?: string, tempFile?: boolean) {
        const [outputType, saveAs, finalAs] = this.parseFormat(command, mimeType);
        if (outputType) {
            return await performCommand(uri, command, outputType, finalAs)
                .then(handler => handler.getBuffer(tempFile, saveAs, finalAs))
                .catch(() => tempFile ? '' : null);
        }
        return tempFile ? '' : null;
    }

    public static async resolveMime(this: IFileManager, data: FileData) {
        const localUri = this.getLocalUri(data);
        if (localUri) {
            const img = await jimp.read(getBuffer(data));
            const mimeType = img.getMIME();
            if (Jimp.MIME_INPUT.has(mimeType)) {
                const output = Image.renameExt(localUri, mimeType.split('/')[1]);
                fs.renameSync(localUri, output);
                this.replace(data.file, output, mimeType);
                return true;
            }
        }
        return false;
    }

    public static using(this: IFileManager, data: FileData, command: string) {
        const mimeType = this.getMimeType(data);
        if (!mimeType || !Jimp.MIME_INPUT.has(mimeType)) {
            return;
        }
        const [outputType, saveAs, finalAs] = Jimp.parseFormat(command, mimeType);
        if (!outputType) {
            return;
        }
        data.outputType = outputType;
        const output = this.queueImage(data, saveAs, command);
        if (!output) {
            return;
        }
        const localUri = this.getLocalUri(data);
        this.performAsyncTask();
        const transformBuffer = (tempFile?: string) => {
            this.formatMessage(this.logType.PROCESS, MODULE_NAME, ['Transforming image...', path.basename(localUri)], command);
            performCommand(tempFile || getBuffer(data), command, outputType, finalAs, this, data)
                .then(handler => {
                    if (handler) {
                        if (command.includes('@') && data.file) {
                            delete data.file.buffer;
                        }
                        handler.write(output, (err: Null<Error>, result: string) => {
                            this.finalizeImage(err, { ...data, output: result, command, errors: handler.errors } as OutputData);
                        });
                    }
                    else {
                        this.completeAsyncTask();
                    }
                })
                .catch(err => this.writeFail(['Unable to read image buffer', MODULE_NAME + path.basename(localUri)], err));
        };
        if (mimeType === 'image/webp') {
            try {
                const tempFile = this.getTempDir(false, '.bmp');
                child_process.execFile(require('dwebp-bin'), [localUri, '-mt', '-bmp', '-o', tempFile], null, err => {
                    if (!err) {
                        transformBuffer(tempFile);
                    }
                    else {
                        this.writeFail(['Unable to convert image buffer', path.basename(localUri)], err);
                        this.completeAsyncTask();
                    }
                });
            }
            catch (err) {
                this.writeFail(['Install WebP?', 'npm i dwebp-bin'], err);
                this.completeAsyncTask();
            }
        }
        else {
            transformBuffer();
        }
    }

    public readonly moduleName = MODULE_NAME;

    private _finalAs: Undef<string> = '';
    private _startTime = 0;

    constructor(public instance: jimp) {
        super();
    }

    reset() {
        super.reset();
        this._finalAs = '';
        this._startTime = 0;
    }
    setCommand(value: string, finalAs?: string) {
        super.setCommand(value);
        this._finalAs = finalAs;
        this._startTime = Date.now();
    }
    method() {
        if (this.methodData) {
            for (const name of this.methodData) {
                switch (name) {
                    case 'dither565':
                    case 'greyscale':
                    case 'invert':
                    case 'normalize':
                    case 'opaque':
                    case 'sepia':
                        try {
                            this.instance = this.instance[name]();
                        }
                        catch (err) {
                            this.writeFail(['Method not supported', this.moduleName + ':' + name], err);
                        }
                        break;
                }
            }
        }
    }
    crop() {
        const cropData = this.cropData;
        if (cropData) {
            this.instance = this.instance.crop(cropData.x, cropData.y, cropData.width, cropData.height);
        }
    }
    opacity() {
        if (!isNaN(this.opacityValue)) {
            this.instance = this.instance.opacity(this.opacityValue);
        }
    }
    quality() {
        const qualityData = this.qualityData;
        if (qualityData && !isNaN(qualityData.value)) {
            this.instance = this.instance.quality(qualityData.value);
        }
    }
    resize() {
        if (this.resizeData) {
            const { width, height, color, algorithm, align, mode } = this.resizeData;
            if (!isNaN(color)) {
                this.instance = this.instance.background(color);
            }
            let resizeMode: string = jimp.RESIZE_NEAREST_NEIGHBOR,
                flags = 0;
            switch (algorithm) {
                case 'bilinear':
                    resizeMode = jimp.RESIZE_BILINEAR;
                    break;
                case 'bicubic':
                    resizeMode = jimp.RESIZE_BICUBIC;
                    break;
                case 'hermite':
                    resizeMode = jimp.RESIZE_HERMITE;
                    break;
                case 'bezier':
                    resizeMode = jimp.RESIZE_BEZIER;
                    break;
            }
            switch (align[0]) {
                case 'left':
                    flags |= jimp.HORIZONTAL_ALIGN_LEFT;
                    break;
                case 'center':
                    flags |= jimp.HORIZONTAL_ALIGN_CENTER;
                    break;
                case 'right':
                    flags |= jimp.HORIZONTAL_ALIGN_RIGHT;
                    break;
            }
            switch (align[1]) {
                case 'top':
                    flags |= jimp.VERTICAL_ALIGN_TOP;
                    break;
                case 'middle':
                    flags |= jimp.VERTICAL_ALIGN_MIDDLE;
                    break;
                case 'bottom':
                    flags |= jimp.VERTICAL_ALIGN_BOTTOM;
                    break;
            }
            switch (mode) {
                case 'contain':
                    this.instance = this.instance.contain(width, height, flags);
                    break;
                case 'cover':
                    this.instance = this.instance.cover(width, height, flags);
                    break;
                case 'scale':
                    this.instance = this.instance.scaleToFit(width, height);
                    break;
                default:
                    this.instance = this.instance.resize(width === Infinity ? jimp.AUTO : width, height === Infinity ? jimp.AUTO : height, resizeMode);
                    break;
            }
        }
    }
    rotate(pathFile?: string, callback?: FinalizeImageCallback<string>): Void<Promise<unknown>[]> {
        const tasks: Promise<unknown>[] = [];
        if (this.rotateData) {
            const { values, color } = this.rotateData;
            if (!isNaN(color)) {
                this.instance = this.instance.background(color);
            }
            const length = values.length;
            const deg = values[0];
            if (length > 1 && pathFile) {
                pathFile = Image.renameExt(pathFile, '::');
                for (let i = 1; i < length; ++i) {
                    const value = values[i];
                    const img = this.instance.clone().rotate(value);
                    const output = pathFile.replace('::', value.toString());
                    tasks.push(
                        img.writeAsync(output)
                            .then(() => {
                                this.finalize(output, (err: Null<Error>, result: string) => {
                                    if (callback) {
                                        callback(err, result);
                                    }
                                });
                            })
                            .catch(err => this.writeFail(['Unable to rotate image', this.moduleName], err))
                    );
                }
            }
            if (deg) {
                this.instance = this.instance.rotate(deg);
            }
        }
        if (tasks.length) {
            return tasks;
        }
    }
    write(output: string, callback?: FinalizeImageCallback) {
        this.instance.write(output, err => {
            if (!err) {
                this.finalize(output, (error: Null<Error>, result: string) => {
                    if (this._startTime) {
                        if (!error) {
                            this.writeTimeElapsed(this.moduleName, path.basename(result), this._startTime);
                        }
                        this._startTime = 0;
                    }
                    if (callback) {
                        callback(error, output);
                    }
                });
            }
            else if (callback) {
                callback(err, '');
            }
        });
    }
    getBuffer(tempFile?: boolean, saveAs?: string, finalAs?: string) {
        const output = this.getTempDir(false, '.' + (finalAs || (saveAs && Jimp.MIME_OUTPUT.has('image/' + (saveAs === 'jpg' ? 'jpeg' : saveAs)) ? saveAs : this.instance.getMIME().split('/').pop()!)));
        return new Promise<Null<Buffer | string>>(resolve => {
            this.instance.write(output, err => {
                if (!err) {
                    this.finalize(output, (err_1: Null<Error>, result: string) => {
                        if (!err_1) {
                            if (tempFile) {
                                resolve(output);
                            }
                            else {
                                fs.readFile(result, (err_2: Null<Error>, data: Buffer) => {
                                    resolve(!err_2 ? data : null);
                                    try {
                                        fs.unlinkSync(result);
                                    }
                                    catch {
                                    }
                                });
                            }
                        }
                        else {
                            resolve(tempFile ? '' : null);
                        }
                    }, finalAs);
                }
                else {
                    resolve(tempFile ? '' : null);
                }
            });
        });
    }
    finalize(output: string, callback: (err: Null<Error>, result: string) => void, finalAs?: string) {
        if (this._finalAs === 'webp' || finalAs === 'webp') {
            const webp = Image.renameExt(output, 'webp');
            const args = [output, '-mt', '-m', '6'];
            if (this.qualityData) {
                const { value, preset, nearLossless } = this.qualityData;
                if (preset) {
                    args.push('-preset', preset);
                }
                if (!isNaN(value)) {
                    args.push('-q', value.toString());
                }
                if (!isNaN(nearLossless)) {
                    args.push('-near_lossless', nearLossless.toString());
                }
            }
            args.push('-o', webp);
            child_process.execFile(require('cwebp-bin'), args, null, err => {
                if (err) {
                    this.writeFail(['Install WebP?', 'npm i cwebp-bin'], err);
                    callback(err, output);
                }
                else if (webp !== output) {
                    fs.unlink(output, error => {
                        if (error) {
                            this.writeFail(['Unable to delete source image', this.moduleName], error);
                        }
                        callback(null, webp);
                    });
                }
                else {
                    callback(null, webp);
                }
            });
        }
        else {
            callback(null, output);
        }
    }
    get rotateCount() {
        return this.rotateData ? this.rotateData.values.length : 0;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Jimp;
    module.exports.default = Jimp;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Jimp;