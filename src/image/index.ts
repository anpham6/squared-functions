import fs = require('fs');
import jimp = require('jimp');
import mime = require('mime-types');

import Module from '../module';

type CompressFormat = functions.squared.base.CompressFormat;

type IFileManager = functions.IFileManager;
type ExpressAsset = functions.ExpressAsset;
type FileManagerPerformAsyncTaskCallback = functions.FileManagerPerformAsyncTaskCallback;
type FileManagerCompleteAsyncTaskCallback = functions.FileManagerCompleteAsyncTaskCallback;
type FileManagerWriteImageCallback = functions.FileManagerWriteImageCallback;

type ResizeData = functions.internal.ResizeData;
type CropData = functions.internal.CropData;
type RotateData = functions.internal.RotateData;

const REGEXP_RESIZE = /\(\s*(\d+|auto)\s*x\s*(\d+|auto)(?:\s*\[\s*(bilinear|bicubic|hermite|bezier)\s*\])?(?:\s*^\s*(contain|cover|scale)(?:\s*\[\s*(left|center|right)?(?:\s*\|?\s*(top|middle|bottom))?\s*\])?)?(?:\s*#\s*([A-Fa-f\d]{1,8}))?\s*\)/;
const REGEXP_CROP = /\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*\|\s*(\d+)\s*x\s*(\d+)\s*\)/;
const REGEXP_ROTATE = /\{\s*([\d\s,]+)(?:\s*#\s*([A-Fa-f\d]{1,8}))?\s*\}/;
const REGEXP_OPACITY = /\|\s*([\d.]+)\s*\|/;

const parseHexDecimal = (value: Undef<string>) => value ? +('0x' + value.padEnd(8, 'F')) : null;

class JimpProxy implements functions.ImageProxy<jimp> {
    public resizeData?: ResizeData;
    public cropData?: CropData;
    public rotateData?: RotateData;
    public qualityValue = NaN;
    public opacityValue = NaN;
    public errorHandler?: (err: Error) => void;

    constructor(public instance: jimp, public filepath: string, public command = '') {
        if (command) {
            this.resizeData = Image.parseResize(command);
            this.cropData = Image.parseCrop(command);
            this.rotateData = Image.parseRotation(command);
            this.qualityValue = Image.parseQuality(command);
            this.opacityValue = Image.parseOpacity(command);
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
        if (!isNaN(this.qualityValue)) {
            this.instance = this.instance.quality(this.qualityValue);
        }
    }
    resize() {
        const resizeData = this.resizeData;
        if (resizeData) {
            const { width, height, color } = resizeData;
            if (color !== null) {
                this.instance = this.instance.background(color);
            }
            switch (resizeData.mode) {
                case 'contain':
                    this.instance = this.instance.contain(width, height, resizeData.align);
                    break;
                case 'cover':
                    this.instance = this.instance.cover(width, height, resizeData.align);
                    break;
                case 'scale':
                    this.instance = this.instance.scaleToFit(width, height);
                    break;
                default:
                    this.instance = this.instance.resize(width === Infinity ? jimp.AUTO : width, height === Infinity ? jimp.AUTO : height, resizeData.algorithm);
                    break;
            }
        }
    }
    rotate(preRotate?: FileManagerPerformAsyncTaskCallback, postWrite?: FileManagerCompleteAsyncTaskCallback) {
        const rotateData = this.rotateData;
        if (rotateData) {
            const { values, color } = rotateData;
            if (color !== null) {
                this.instance = this.instance.background(color);
            }
            const deg = values[0];
            for (let i = 1, length = values.length; i < length; ++i) {
                const value = values[i];
                if (preRotate) {
                    preRotate();
                }
                const img = this.instance.clone().rotate(value);
                const index = this.filepath.lastIndexOf('.');
                let output = this.filepath.substring(0, index) + '.' + value + this.filepath.substring(index);
                img.write(output, err => {
                    if (err) {
                        Image.writeFail(output, err);
                        output = '';
                    }
                    if (postWrite) {
                        postWrite(output);
                    }
                });
            }
            if (deg) {
                this.instance = this.instance.rotate(deg);
            }
        }
    }
    write(output: string, file?: ExpressAsset, compress?: CompressFormat, callback?: FileManagerWriteImageCallback) {
        this.instance.write(output, err => {
            if (file && callback) {
                callback(file, this.filepath, output, this.command, compress, err);
            }
            else if (err && this.errorHandler) {
                this.errorHandler(err);
            }
        });
    }
}

const Image = new class extends Module implements functions.IImage {
    using(this: IFileManager, file: ExpressAsset, filepath: string, compress?: CompressFormat, command = '') {
        command = command.trim();
        const mimeType = file.mimeType || mime.lookup(filepath);
        if (!command || !mimeType || mimeType === 'image/unknown') {
            this.performAsyncTask();
            jimp.read(filepath)
                .then(img => {
                    const unknownType = img.getMIME();
                    switch (unknownType) {
                        case jimp.MIME_PNG:
                        case jimp.MIME_JPEG:
                        case jimp.MIME_BMP:
                        case jimp.MIME_GIF:
                        case jimp.MIME_TIFF:
                            try {
                                const output = this.replaceExtension(filepath, unknownType.split('/')[1]);
                                fs.renameSync(filepath, output);
                                this.finalizeImage(file, filepath, output, '@', unknownType === jimp.MIME_PNG || unknownType === jimp.MIME_JPEG ? compress : undefined);
                            }
                            catch (err) {
                                this.completeAsyncTask();
                                this.writeFail(filepath, err);
                            }
                            break;
                        default: {
                            const output = this.replaceExtension(filepath, 'png');
                            const proxy = new JimpProxy(img, filepath, '@');
                            proxy.write(output, file, compress, this.finalizeImage.bind(this));
                        }
                    }
                })
                .catch(err => {
                    this.completeAsyncTask();
                    this.writeFail(filepath, err);
                });
        }
        else {
            let jimpType: Undef<string>,
                saveAs: Undef<string>;
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
            if (jimpType && saveAs) {
                this.performAsyncTask();
                jimp.read(filepath)
                    .then(img => {
                        const proxy = new JimpProxy(img, filepath, command);
                        proxy.resize();
                        proxy.crop();
                        if (jimpType === jimp.MIME_JPEG) {
                            proxy.quality();
                        }
                        else {
                            proxy.opacity();
                        }
                        proxy.rotate(this.performAsyncTask.bind(this), this.completeAsyncTask.bind(this));
                        proxy.write(
                            this.newImage(filepath, mimeType, jimpType!, saveAs!, command),
                            file,
                            compress,
                            this.finalizeImage.bind(this)
                        );
                    })
                    .catch(err => {
                        this.completeAsyncTask();
                        this.writeFail(filepath, err);
                    });
            }
        }
    }
    parseResize(value: string) {
        const match = REGEXP_RESIZE.exec(value);
        if (match) {
            let algorithm: string = jimp.RESIZE_NEAREST_NEIGHBOR,
                align = 0;
            switch (match[3]) {
                case 'bilinear':
                    algorithm = jimp.RESIZE_BILINEAR;
                    break;
                case 'bicubic':
                    algorithm = jimp.RESIZE_BICUBIC;
                    break;
                case 'hermite':
                    algorithm = jimp.RESIZE_HERMITE;
                    break;
                case 'bezier':
                    algorithm = jimp.RESIZE_BEZIER;
                    break;
            }
            switch (match[5]) {
                case 'left':
                    align |= jimp.HORIZONTAL_ALIGN_LEFT;
                    break;
                case 'center':
                    align |= jimp.HORIZONTAL_ALIGN_CENTER;
                    break;
                case 'right':
                    align |= jimp.HORIZONTAL_ALIGN_RIGHT;
                    break;
            }
            switch (match[6]) {
                case 'top':
                    align |= jimp.VERTICAL_ALIGN_TOP;
                    break;
                case 'middle':
                    align |= jimp.VERTICAL_ALIGN_MIDDLE;
                    break;
                case 'bottom':
                    align |= jimp.VERTICAL_ALIGN_BOTTOM;
                    break;
            }
            return { width: match[1] === 'auto' ? Infinity : +match[1], height: match[2] === 'auto' ? Infinity : +match[2], mode: match[4] || 'resize', algorithm, align, color: parseHexDecimal(match[7]) } as ResizeData;
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
        const match = REGEXP_OPACITY.exec(value);
        if (match) {
            const quality = +match[1];
            if (quality >= 1 && quality <= 100) {
                return Math.round(quality);
            }
        }
        return NaN;
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
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Image;
    module.exports.default = Image;
    module.exports.__esModule = true;
}

export default Image;