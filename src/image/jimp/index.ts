import fs = require('fs');
import child_process = require('child_process');
import jimp = require('jimp');
import mime = require('mime-types');
import uuid = require('uuid');

import Image from '../index';

type IFileManager = functions.IFileManager;
type ExternalAsset = functions.ExternalAsset;
type FileManagerPerformAsyncTaskCallback = functions.FileManagerPerformAsyncTaskCallback;
type FileManagerCompleteAsyncTaskCallback = functions.FileManagerCompleteAsyncTaskCallback;
type ResizeData = functions.internal.Image.ResizeData;
type CropData = functions.internal.Image.CropData;
type RotateData = functions.internal.Image.RotateData;
type QualityData = functions.internal.Image.QualityData;
type UsingOptions = functions.internal.Image.UsingOptions;

class Jimp extends Image implements functions.ImageProxy<jimp> {
    static async using(this: IFileManager, options: UsingOptions) {
        const { data, compress } = options;
        const { file, fileUri } = data;
        const command = options.command?.trim().toLowerCase();
        const mimeType = file.mimeType || mime.lookup(fileUri);
        const getFile = () => {
            const buffer = file.buffer;
            if (buffer) {
                delete file.buffer;
                return (buffer as unknown) as string;
            }
            return fileUri;
        };
        if (!command || !mimeType || mimeType === 'image/unknown') {
            const img = await jimp.read(getFile());
            const unknownType = img.getMIME();
            switch (unknownType) {
                case jimp.MIME_PNG:
                case jimp.MIME_JPEG:
                case jimp.MIME_BMP:
                case jimp.MIME_GIF:
                case jimp.MIME_TIFF: {
                    options.output = this.replaceExtension(fileUri, unknownType.split('/')[1]);
                    options.command = '@';
                    options.compress = unknownType === jimp.MIME_PNG || unknownType === jimp.MIME_JPEG ? compress : undefined;
                    file.mimeType = unknownType;
                    fs.renameSync(fileUri, options.output);
                    break;
                }
            }
            this.finalizeImage(options);
        }
        else {
            file.mimeType = mimeType;
            let jimpType: Undef<string>,
                tempFile: Undef<string>,
                saveAs: Undef<string>,
                finalAs: Undef<string>;
            const resumeThread = () => {
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
                        this.performAsyncTask();
                        jimp.read(tempFile || getFile())
                            .then(img => {
                                const proxy = new Jimp(img, fileUri, command, finalAs);
                                proxy.method();
                                proxy.resize();
                                proxy.crop();
                                if (jimpType === jimp.MIME_JPEG && !finalAs) {
                                    proxy.quality();
                                }
                                else {
                                    proxy.opacity();
                                }
                                proxy.rotate(this.performAsyncTask.bind(this), this.completeAsyncTask.bind(this), file);
                                proxy.write(output, options);
                            })
                            .catch(err => {
                                this.completeAsyncTask();
                                this.writeFail(['Unable to read image buffer', fileUri], err);
                            });
                    }
                }
            };
            if (mimeType === 'image/webp') {
                try {
                    tempFile = this.getTempDir() + uuid.v4() + '.bmp';
                    child_process.execFile(require('dwebp-bin'), [fileUri, '-mt', '-bmp', '-o', tempFile], null, err => {
                        if (err) {
                            tempFile = '';
                        }
                        resumeThread();
                    });
                }
                catch (err) {
                    this.writeFail(['Install WebP?', 'npm i dwebp-bin'], err);
                    tempFile = '';
                    resumeThread();
                }
            }
            else {
                resumeThread();
            }
        }
    }

    public resizeData?: ResizeData;
    public cropData?: CropData;
    public rotateData?: RotateData;
    public qualityData?: QualityData;
    public methodData?: string[];
    public opacityValue = NaN;
    public errorHandler?: (err: Error) => void;

    constructor(public instance: jimp, public fileUri: string, public command = '', public finalAs?: string) {
        super();
        if (command) {
            this.resizeData = this.parseResize(command);
            this.cropData = this.parseCrop(command);
            this.rotateData = this.parseRotation(command);
            this.qualityData = this.parseQuality(command);
            this.opacityValue = this.parseOpacity(command);
            this.methodData = this.parseMethod(command);
        }
    }

    method() {
        const methodData = this.methodData;
        if (methodData) {
            for (const name of methodData) {
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
                            this.writeFail(['Method not supported', `jimp:${name}`], err);
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
        const resizeData = this.resizeData;
        if (resizeData) {
            const { width, height, color, algorithm, align } = resizeData;
            if (!isNaN(color)) {
                this.instance = this.instance.background(color);
            }
            let mode: string = jimp.RESIZE_NEAREST_NEIGHBOR,
                flags = 0;
            switch (algorithm) {
                case 'bilinear':
                    mode = jimp.RESIZE_BILINEAR;
                    break;
                case 'bicubic':
                    mode = jimp.RESIZE_BICUBIC;
                    break;
                case 'hermite':
                    mode = jimp.RESIZE_HERMITE;
                    break;
                case 'bezier':
                    mode = jimp.RESIZE_BEZIER;
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
            switch (resizeData.mode) {
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
                    this.instance = this.instance.resize(width === Infinity ? jimp.AUTO : width, height === Infinity ? jimp.AUTO : height, mode);
                    break;
            }
        }
    }
    rotate(initialize?: FileManagerPerformAsyncTaskCallback, callback?: FileManagerCompleteAsyncTaskCallback, parent?: ExternalAsset) {
        const rotateData = this.rotateData;
        if (rotateData) {
            const { values, color } = rotateData;
            if (!isNaN(color)) {
                this.instance = this.instance.background(color);
            }
            const fileUri = this.fileUri;
            const deg = values[0];
            for (let i = 1, length = values.length; i < length; ++i) {
                const value = values[i];
                if (initialize) {
                    initialize(parent);
                }
                const img = this.instance.clone().rotate(value);
                const index = fileUri.lastIndexOf('.');
                const output = fileUri.substring(0, index) + '.' + value + fileUri.substring(index);
                img.write(output, err => {
                    if (!err) {
                        this.finalize(output, (result: string) => {
                            if (callback) {
                                callback(result, parent);
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
    write(output: string, options: UsingOptions) {
        this.instance.write(output, err => {
            if (options.data && options.callback) {
                this.finalize(output, (result: string) => options.callback!({ ...options, output: result }, err));
            }
            else if (err && this.errorHandler) {
                this.errorHandler(err);
            }
        });
    }
    finalize(output: string, callback: (result: string) => void) {
        if (this.finalAs === 'webp') {
            const webp = this.replaceExtension(output, 'webp');
            const args = [output, '-mt', '-m', '6'];
            const qualityData = this.qualityData;
            if (qualityData) {
                const { value, preset, nearLossless } = qualityData;
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