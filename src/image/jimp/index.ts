import path = require('path');
import fs = require('fs');
import child_process = require('child_process');
import jimp = require('jimp');

import Image from '../index';

type IFileManager = functions.IFileManager;
type FileManagerPerformAsyncTaskCallback = functions.FileManagerPerformAsyncTaskCallback;
type FileManagerCompleteAsyncTaskCallback = functions.FileManagerCompleteAsyncTaskCallback;
type FileManagerFinalizeImageMethod = functions.FileManagerFinalizeImageMethod;

type FileData = functions.internal.FileData;
type ResizeData = functions.internal.Image.ResizeData;
type CropData = functions.internal.Image.CropData;
type RotateData = functions.internal.Image.RotateData;
type QualityData = functions.internal.Image.QualityData;

const getBuffer = (data: FileData) => (data.file.buffer as unknown) as string || data.file.fileUri!;

class Jimp extends Image implements functions.ImageCommand<jimp> {
    public static async resolveMime(this: IFileManager, data: FileData) {
        const img = await jimp.read(getBuffer(data));
        const mimeType = img.getMIME();
        switch (mimeType) {
            case jimp.MIME_PNG:
            case jimp.MIME_JPEG:
            case jimp.MIME_BMP:
            case jimp.MIME_GIF:
            case jimp.MIME_TIFF: {
                const fileUri = data.file.fileUri!;
                const output = Image.renameExt(fileUri, mimeType.split('/')[1]);
                fs.renameSync(fileUri, output);
                this.replace(data.file, output, mimeType);
                return true;
            }
        }
        return false;
    }

    public static using(this: IFileManager, data: FileData, command: string, callback?: FileManagerFinalizeImageMethod) {
        const file = data.file;
        const fileUri = file.fileUri!;
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
            if (jimpType && saveAs) {
                const output = this.queueImage(data, jimpType, saveAs, command);
                if (output) {
                    this.formatMessage(this.logType.PROCESS, 'jimp', ['Transforming image...', path.basename(fileUri)], command);
                    const startTime = Date.now();
                    jimp.read(tempFile || getBuffer(data))
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
                            this.completeAsyncTask();
                            this.writeFail(['Unable to read image buffer', path.basename(fileUri)], err);
                        });
                    return;
                }
            }
            this.completeAsyncTask();
        };
        this.performAsyncTask();
        if (mimeType === 'image/webp') {
            try {
                const tempFile = this.getTempDir(false, '.bmp');
                child_process.execFile(require('dwebp-bin'), [fileUri, '-mt', '-bmp', '-o', tempFile], null, err => {
                    if (!err) {
                        transformImage(tempFile);
                    }
                    else {
                        this.writeFail(['Unable to convert image buffer', path.basename(fileUri)], err);
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
    public errorHandler?: (err: Error) => void;

    constructor(public instance: jimp, public data: FileData, public command: string, public finalAs?: string) {
        super();
        this.resizeData = this.parseResize(command);
        this.cropData = this.parseCrop(command);
        this.rotateData = this.parseRotation(command);
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
                            this.writeFail(['Method not supported', 'jimp: ' + name], err);
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
    rotate(initialize?: FileManagerPerformAsyncTaskCallback, callback?: FileManagerCompleteAsyncTaskCallback) {
        if (this.rotateData) {
            const { values, color } = this.rotateData;
            if (!isNaN(color)) {
                this.instance = this.instance.background(color);
            }
            const file = this.data.file;
            const fileUri = file.fileUri!;
            const deg = values[0];
            for (let i = 1, length = values.length; i < length; ++i) {
                const value = values[i];
                if (initialize) {
                    initialize();
                }
                const img = this.instance.clone().rotate(value);
                const index = fileUri.lastIndexOf('.');
                const output = fileUri.substring(0, index) + '.' + value + fileUri.substring(index);
                img.write(output, err => {
                    if (!err) {
                        this.finalize(output, (result: string) => {
                            if (callback) {
                                callback(result, file);
                            }
                        });
                    }
                    else {
                        this.writeFail(['Unable to rotate image', output], err);
                        if (callback) {
                            callback();
                        }
                    }
                });
            }
            if (deg) {
                this.instance = this.instance.rotate(deg);
            }
        }
    }
    write(output: string, startTime?: number, callback?: FileManagerFinalizeImageMethod) {
        this.instance.write(output, err => {
            if (!err) {
                this.finalize(output, (result: string) => {
                    if (startTime) {
                        this.writeTimeElapsed('jimp', path.basename(result), startTime);
                    }
                    if (callback) {
                        callback({ ...this.data, output: result, command: this.command }, err);
                    }
                });
            }
            else if (this.errorHandler) {
                this.errorHandler(err);
            }
        });
    }
    finalize(output: string, callback: (result: string) => void) {
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
                    callback(output);
                }
                else if (webp !== output) {
                    fs.unlink(output, error => {
                        if (error) {
                            this.writeFail(['Unable to delete temp image', output], error);
                        }
                        callback(webp);
                    });
                }
                else {
                    callback(webp);
                }
            });
        }
        else {
            callback(output);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Jimp;
    module.exports.default = Jimp;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Jimp;