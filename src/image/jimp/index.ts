import type { ExternalAsset, FileManagerCompleteAsyncTaskCallback, FileManagerFinalizeImageCallback, FileManagerPerformAsyncTaskMethod, IFileManager, ImageHandler, Internal } from '../../types/lib';

import path = require('path');
import fs = require('fs');
import child_process = require('child_process');
import jimp = require('jimp');

import Image from '../index';

type FileData = Internal.FileData;
type ResizeData = Internal.Image.ResizeData;
type CropData = Internal.Image.CropData;
type RotateData = Internal.Image.RotateData;
type QualityData = Internal.Image.QualityData;

const getBuffer = (file: ExternalAsset) => (file.buffer as unknown) as string || file.localUri!;

class Jimp extends Image implements ImageHandler<jimp> {
    public static async resolveMime(this: IFileManager, data: FileData) {
        const file = data.file;
        const img = await jimp.read(getBuffer(file));
        const mimeType = img.getMIME();
        switch (mimeType) {
            case jimp.MIME_PNG:
            case jimp.MIME_JPEG:
            case jimp.MIME_BMP:
            case jimp.MIME_GIF:
            case jimp.MIME_TIFF: {
                const localUri = file.localUri!;
                const output = Image.renameExt(localUri, mimeType.split('/')[1]);
                fs.renameSync(localUri, output);
                this.replace(file, output, mimeType);
                return true;
            }
        }
        return false;
    }

    public static using(this: IFileManager, data: FileData, command: string, callback?: FileManagerFinalizeImageCallback) {
        const file = data.file;
        const localUri = file.localUri!;
        const mimeType = data.mimeType || file.mimeType;
        const transformImage = (tempFile?: string) => {
            command = command.trim();
            let jimpType: Undef<string>,
                saveAs: Undef<string>,
                finalAs: Undef<string>;
            if (command.startsWith('png')) {
                jimpType = jimp.MIME_PNG;
                saveAs = 'png';
            }
            else if (command.startsWith('jpeg')) {
                jimpType = jimp.MIME_JPEG;
                saveAs = 'jpg';
            }
            else if (command.startsWith('bmp')) {
                jimpType = jimp.MIME_BMP;
                saveAs = 'bmp';
            }
            else if (command.startsWith('webp')) {
                if (mimeType === jimp.MIME_JPEG) {
                    jimpType = jimp.MIME_JPEG;
                    saveAs = 'jpg';
                }
                else {
                    jimpType = jimp.MIME_PNG;
                    saveAs = 'png';
                }
                finalAs = 'webp';
            }
            else {
                this.completeAsyncTask();
                return;
            }
            const output = this.queueImage(data, jimpType, saveAs, command);
            if (output) {
                this.formatMessage(this.logType.PROCESS, 'jimp', ['Transforming image...', path.basename(localUri)], command);
                const startTime = Date.now();
                jimp.read(tempFile || getBuffer(file))
                    .then(img => {
                        if (command.includes('@')) {
                            delete file.buffer;
                        }
                        const proxy = new Jimp(img, data, command, finalAs);
                        proxy.method();
                        proxy.resize();
                        proxy.crop();
                        if (jimpType === jimp.MIME_JPEG && !finalAs) {
                            proxy.quality();
                        }
                        else {
                            proxy.opacity();
                        }
                        proxy.rotate(this.performAsyncTask.bind(this), this.completeAsyncTask.bind(this));
                        proxy.write(output, startTime, callback);
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

    public resizeData?: ResizeData;
    public cropData?: CropData;
    public rotateData?: RotateData;
    public qualityData?: QualityData;
    public methodData?: string[];
    public opacityValue = NaN;
    public readonly moduleName = 'jimp';

    constructor(public instance: jimp, public data: FileData, public command: string, public finalAs?: string) {
        super();
        this.resizeData = this.parseResize(command);
        this.cropData = this.parseCrop(command);
        this.rotateData = this.parseRotate(command);
        this.qualityData = this.parseQuality(command);
        this.opacityValue = this.parseOpacity(command);
        this.methodData = this.parseMethod(command);
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
    rotate(performAsyncTask?: FileManagerPerformAsyncTaskMethod, callback?: FileManagerCompleteAsyncTaskCallback) {
        if (this.rotateData) {
            const { values, color } = this.rotateData;
            if (!isNaN(color)) {
                this.instance = this.instance.background(color);
            }
            const file = this.data.file;
            const localUri = file.localUri!;
            const deg = values[0];
            for (let i = 1, length = values.length; i < length; ++i) {
                const value = values[i];
                if (performAsyncTask) {
                    performAsyncTask();
                }
                const img = this.instance.clone().rotate(value);
                const index = localUri.lastIndexOf('.');
                const output = localUri.substring(0, index) + '.' + value + localUri.substring(index);
                img.write(output, err => {
                    if (!err) {
                        this.finalize(output, (error: Null<Error>, result: string) => {
                            if (callback) {
                                callback(error, result, file);
                            }
                        });
                    }
                    else {
                        this.writeFail(['Unable to rotate image <jimp>', path.basename(output)], err);
                        if (callback) {
                            callback(err);
                        }
                    }
                });
            }
            if (deg) {
                this.instance = this.instance.rotate(deg);
            }
        }
    }
    write(output: string, startTime?: number, callback?: FileManagerFinalizeImageCallback) {
        this.instance.write(output, err => {
            if (!err) {
                this.finalize(output, (error: Null<Error>, result: string) => {
                    if (startTime) {
                        this.writeTimeElapsed('jimp', path.basename(result), startTime);
                    }
                    if (callback) {
                        callback(error, { ...this.data, output: result, command: this.command, errors: this.errors });
                    }
                });
            }
            else if (callback) {
                callback(err, { file: this.data.file, output: '', command: this.command, errors: this.errors });
            }
        });
    }
    finalize(output: string, callback: (err: Null<Error>, result: string) => void) {
        if (this.finalAs === 'webp') {
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