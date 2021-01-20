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

const getBuffer = (data: FileData) => data.localUri || (data.file ? (data.file.buffer as unknown) as string || data.file.localUri! : '');

class Jimp extends Image implements IJimpImageHandler {
    public static INPUT_MIME = new Set([jimp.MIME_PNG, jimp.MIME_JPEG, jimp.MIME_BMP, jimp.MIME_GIF, jimp.MIME_TIFF, 'image/webp']);
    public static OUTPUT_MIME = new Set([jimp.MIME_PNG, jimp.MIME_JPEG, jimp.MIME_BMP, 'image/webp']);

    public static parseFormat(value: string, mimeType?: string): [string, string, string] {
        let [outputType, saveAs] = super.parseFormat(value),
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

    public static async resolveMime(this: IFileManager, data: FileData) {
        const localUri = this.getLocalUri(data);
        if (localUri) {
            const img = await jimp.read(getBuffer(data));
            const mimeType = img.getMIME();
            if (Jimp.INPUT_MIME.has(mimeType)) {
                const output = Image.renameExt(localUri, mimeType.split('/')[1]);
                fs.renameSync(localUri, output);
                data.localUri = output;
                if (data.file) {
                    this.replace(data.file, output, mimeType);
                }
                return true;
            }
        }
        return false;
    }

    public static using(this: IFileManager, data: FileData, command: string) {
        const file = data.file;
        const mimeType = data.mimeType || file && file.mimeType;
        const localUri = this.getLocalUri(data);
        const [outputType, saveAs, finalAs] = Jimp.parseFormat(command, mimeType);
        if (!localUri || !mimeType || !Jimp.INPUT_MIME.has(mimeType) || !outputType) {
            return;
        }
        const transformImage = (tempFile?: string) => {
            data.outputType = outputType;
            const output = this.queueImage(data, saveAs, command);
            if (output) {
                this.formatMessage(this.logType.PROCESS, 'jimp', ['Transforming image...', path.basename(localUri)], command);
                jimp.read(tempFile || getBuffer(data))
                    .then(img => {
                        if (file && command.includes('@')) {
                            delete file.buffer;
                        }
                        const proxy = new Jimp(img, data, this);
                        proxy.setCommand(command, finalAs);
                        proxy.method();
                        proxy.resize();
                        proxy.crop();
                        if (outputType === jimp.MIME_JPEG && !finalAs) {
                            proxy.quality();
                        }
                        else {
                            proxy.opacity();
                        }
                        proxy.rotate();
                        proxy.write(output, this.finalizeImage.bind(this));
                    })
                    .catch(err => {
                        this.writeFail(['Unable to read image buffer', path.basename(localUri)], err);
                        this.completeAsyncTask();
                    });
            }
            else {
                this.completeAsyncTask();
            }
        };
        this.performAsyncTask();
        if (mimeType === 'image/webp') {
            try {
                const tempFile = this.getTempDir(false, '.bmp');
                child_process.execFile(require('dwebp-bin'), [localUri, '-mt', '-bmp', '-o', tempFile], null, err => {
                    if (!err) {
                        transformImage(tempFile);
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
            transformImage();
        }
    }

    public readonly moduleName = 'jimp';

    private _finalAs: Undef<string> = '';
    private _startTime = 0;

    constructor(public instance: jimp, public data?: FileData, public host?: IFileManager) {
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
                            this.writeFail(['Method not supported <jimp>', name], err);
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
    rotate() {
        if (this.rotateData) {
            const { values, color } = this.rotateData;
            if (!isNaN(color)) {
                this.instance = this.instance.background(color);
            }
            const deg = values[0];
            const data = this.data;
            if (data) {
                const file = data.file;
                const localUri = data.localUri || file && file.localUri!;
                if (localUri) {
                    const host = this.host;
                    for (let i = 1, length = values.length; i < length; ++i) {
                        const value = values[i];
                        const img = this.instance.clone().rotate(value);
                        const index = localUri.lastIndexOf('.');
                        const output = localUri.substring(0, index) + '.' + value + localUri.substring(index);
                        if (host) {
                            host.performAsyncTask();
                        }
                        img.write(output, err => {
                            if (!err) {
                                this.finalize(output, (error: Null<Error>, result: string) => {
                                    if (host) {
                                        host.completeAsyncTask(error, result, file);
                                    }
                                });
                            }
                            else {
                                this.writeFail(['Unable to rotate image <jimp>', path.basename(output)], err);
                                if (host) {
                                    host.completeAsyncTask(err);
                                }
                            }
                        });
                    }
                }
            }
            if (deg) {
                this.instance = this.instance.rotate(deg);
            }
        }
    }
    write(output: string, callback?: FinalizeImageCallback) {
        this.instance.write(output, err => {
            const imageData = { ...this.data, output: '', command: this.getCommand(), errors: this.errors } as OutputData;
            if (!err) {
                this.finalize(output, (error: Null<Error>, result: string) => {
                    if (this._startTime) {
                        this.writeTimeElapsed('jimp', path.basename(result), this._startTime);
                        this._startTime = 0;
                    }
                    if (callback) {
                        imageData.output = result;
                        callback(error, imageData);
                    }
                });
            }
            else if (callback) {
                callback(err, imageData);
            }
        });
    }
    getBuffer(saveAs?: string, finalAs?: string) {
        const output = this.getTempDir(false, '.' + (saveAs && Jimp.OUTPUT_MIME.has('image/' + (saveAs === 'jpg' ? 'jpeg' : saveAs)) ? saveAs : this.instance.getMIME().split('/').pop()!));
        return new Promise<Null<Buffer>>(resolve => {
            this.instance.write(output, err => {
                if (!err) {
                    this.finalize(output, (err_1: Null<Error>, result: string) => {
                        if (!err_1) {
                            fs.readFile(result, (err_2: Null<Error>, data: Buffer) => resolve(!err_2 ? data : null));
                        }
                        else {
                            resolve(null);
                        }
                    }, finalAs);
                }
                else {
                    resolve(null);
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
                            this.writeFail(['Unable to delete source image', output], error);
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
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Jimp;
    module.exports.default = Jimp;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Jimp;