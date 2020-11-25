import fs = require('fs');
import child_process = require('child_process');
import jimp = require('jimp');
import mime = require('mime-types');
import uuid = require('uuid');

import Module from '../module';

type ExternalAsset = functions.ExternalAsset;
type IFileManager = functions.IFileManager;
type FileManagerPerformAsyncTaskCallback = functions.FileManagerPerformAsyncTaskCallback;
type FileManagerCompleteAsyncTaskCallback = functions.FileManagerCompleteAsyncTaskCallback;
type FileManagerWriteImageCallback = functions.FileManagerWriteImageCallback;

type CompressFormat = functions.squared.CompressFormat;

type FileData = functions.internal.FileData;
type ResizeData = functions.internal.Image.ResizeData;
type CropData = functions.internal.Image.CropData;
type RotateData = functions.internal.Image.RotateData;
type QualityData = functions.internal.Image.QualityData;
type UsingOptions = functions.internal.Image.UsingOptions;

const REGEXP_RESIZE = /\(\s*(\d+|auto)\s*x\s*(\d+|auto)(?:\s*\[\s*(bilinear|bicubic|hermite|bezier)\s*\])?(?:\s*^\s*(contain|cover|scale)(?:\s*\[\s*(left|center|right)?(?:\s*\|?\s*(top|middle|bottom))?\s*\])?)?(?:\s*#\s*([A-Fa-f\d]{1,8}))?\s*\)/;
const REGEXP_CROP = /\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*\|\s*(\d+)\s*x\s*(\d+)\s*\)/;
const REGEXP_ROTATE = /\{\s*([\d\s,]+)(?:\s*#\s*([A-Fa-f\d]{1,8}))?\s*\}/;
const REGEXP_OPACITY = /\|\s*(\d*\.\d+)\s*\|/;
const REGEXP_QUALITY = /\|\s*(\d+)(?:\s*\[\s*(photo|picture|drawing|icon|text)\s*\])?(?:\s*\[\s*(\d+)\s*\])?\s*\|/;
const REGEXP_METHOD = /!\s*([A-Za-z$][\w$]*)/g;

const parseHexDecimal = (value: Undef<string>) => value ? +('0x' + value.padEnd(8, 'F')) : NaN;

class JimpProxy implements functions.ImageProxy<jimp> {
    public resizeData?: ResizeData;
    public cropData?: CropData;
    public rotateData?: RotateData;
    public qualityData?: QualityData;
    public methodData?: string[];
    public opacityValue = NaN;
    public errorHandler?: (err: Error) => void;

    constructor(public instance: jimp, public fileUri: string, public command = '', public finalAs?: string) {
        if (command) {
            this.resizeData = Image.parseResize(command);
            this.cropData = Image.parseCrop(command);
            this.rotateData = Image.parseRotation(command);
            this.qualityData = Image.parseQuality(command);
            this.opacityValue = Image.parseOpacity(command);
            this.methodData = Image.parseMethod(command);
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
                            Image.writeFail(['Method not supported', `jimp:${name}`], err);
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
    rotate(parent?: ExternalAsset, initialize?: FileManagerPerformAsyncTaskCallback, callback?: FileManagerCompleteAsyncTaskCallback) {
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
                    initialize();
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
                        Image.writeFail(['Unable to rotate image', output], err);
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
    write(output: string, options?: UsingOptions) {
        if (output) {
            let data: Undef<FileData>,
                compress: Undef<CompressFormat>,
                callback: Undef<FileManagerWriteImageCallback>;
            if (options) {
                ({ data, compress, callback } = options);
            }
            this.instance.write(output, err => {
                if (data && callback) {
                    this.finalize(output, (result: string) => callback!(data!, result, this.command, compress, err));
                }
                else if (err && this.errorHandler) {
                    this.errorHandler(err);
                }
            });
        }
    }
    finalize(output: string, callback: (result: string) => void) {
        if (this.finalAs === 'webp') {
            const webp = Image.replaceExtension(output, 'webp');
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
                    Image.writeFail(['Install WebP?', 'npm i cwebp-bin'], err);
                    callback(output);
                }
                else if (webp !== output) {
                    fs.unlink(output, error => {
                        if (error) {
                            Image.writeFail(['Unable to delete temp image', output], error);
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

const Image = new class extends Module implements functions.IImage {
    using(this: IFileManager, options: UsingOptions) {
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
            this.performAsyncTask();
            jimp.read(getFile())
                .then(img => {
                    const unknownType = img.getMIME();
                    switch (unknownType) {
                        case jimp.MIME_PNG:
                        case jimp.MIME_JPEG:
                        case jimp.MIME_BMP:
                        case jimp.MIME_GIF:
                        case jimp.MIME_TIFF: {
                            const output = this.replaceExtension(fileUri, unknownType.split('/')[1]);
                            fs.rename(fileUri, output, err => {
                                if (!err) {
                                    this.finalizeImage(data, output, '@', unknownType === jimp.MIME_PNG || unknownType === jimp.MIME_JPEG ? compress : undefined);
                                }
                                else {
                                    this.writeFail(['Unable to rename image', fileUri], err);
                                    this.completeAsyncTask();
                                }
                            });
                        }
                    }
                })
                .catch(err => {
                    this.writeFail(['Unable to read image buffer', fileUri], err);
                    this.completeAsyncTask();
                });
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
                    this.performAsyncTask();
                    jimp.read(tempFile || getFile())
                        .then(img => {
                            const proxy = new JimpProxy(img, fileUri, command, finalAs);
                            proxy.method();
                            proxy.resize();
                            proxy.crop();
                            if (jimpType === jimp.MIME_JPEG && !finalAs) {
                                proxy.quality();
                            }
                            else {
                                proxy.opacity();
                            }
                            proxy.rotate(file, this.performAsyncTask.bind(this), this.completeAsyncTask.bind(this));
                            proxy.write(this.newImage(data, jimpType!, saveAs!, command), options);
                        })
                        .catch(err => {
                            this.completeAsyncTask();
                            this.writeFail(['Unable to read image buffer', fileUri], err);
                        });
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
                    Image.writeFail(['Install WebP?', 'npm i dwebp-bin'], err);
                    tempFile = '';
                    resumeThread();
                }
            }
            else {
                resumeThread();
            }
        }
    }
    parseCrop(value: string) {
        const match = REGEXP_CROP.exec(value);
        if (match) {
            return { x: +match[1], y: +match[2], width: +match[3], height: +match[4] } as CropData;
        }
    }
    parseOpacity(value: string) {
        const match = REGEXP_OPACITY.exec(value);
        if (match) {
            const opacity = +match[1];
            if (opacity >= 0 && opacity < 1) {
                return opacity;
            }
        }
        return NaN;
    }
    parseQuality(value: string) {
        const match = REGEXP_QUALITY.exec(value);
        if (match) {
            const result: QualityData = { value: NaN, preset: match[2], nearLossless: NaN };
            const quality = +match[1];
            if (quality >= 0 && quality <= 100) {
                result.value = quality;
            }
            if (match[3]) {
                const nearLossless = +match[3];
                if (nearLossless >= 0 && nearLossless <= 100) {
                    result.nearLossless = nearLossless;
                }
            }
            return result;
        }
    }
    parseResize(value: string) {
        const match = REGEXP_RESIZE.exec(value);
        if (match) {
            return { width: match[1] === 'auto' ? Infinity : +match[1], height: match[2] === 'auto' ? Infinity : +match[2], mode: match[4] || 'resize', algorithm: match[3], align: [match[5], match[6]], color: parseHexDecimal(match[7]) } as ResizeData;
        }
    }
    parseRotation(value: string) {
        const match = REGEXP_ROTATE.exec(value);
        if (match) {
            const result = new Set<number>();
            for (const segment of match[1].split(',')) {
                result.add(+segment);
            }
            if (result.size) {
                return { values: Array.from(result), color: parseHexDecimal(match[2]) } as RotateData;
            }
        }
    }
    parseMethod(value: string) {
        REGEXP_METHOD.lastIndex = 0;
        const result: string[] = [];
        let match: Null<RegExpExecArray>;
        while (match = REGEXP_METHOD.exec(value)) {
            result.push(match[1]);
        }
        if (result.length) {
            return result;
        }
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Image;
    module.exports.default = Image;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Image;