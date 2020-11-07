import path = require('path');
import jimp = require('jimp');

import Module from '../module';

type ResizeData = functions.internal.ResizeData;
type CropData = functions.internal.CropData;
type RotateData = functions.internal.RotateData;

const REGEXP_RESIZE = /\(\s*(\d+|auto)\s*x\s*(\d+|auto)(?:\s*\[\s*(bilinear|bicubic|hermite|bezier)\s*\])?(?:\s*^\s*(contain|cover|scale)(?:\s*\[\s*(left|center|right)?(?:\s*\|?\s*(top|middle|bottom))?\s*\])?)?(?:\s*#\s*([A-Fa-f\d]{1,8}))?\s*\)/;
const REGEXP_CROP = /\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*\|\s*(\d+)\s*x\s*(\d+)\s*\)/;
const REGEXP_ROTATE = /\{\s*([\d\s,]+)(?:\s*#\s*([A-Fa-f\d]{1,8}))?\s*\}/;
const REGEXP_OPACITY = /\|\s*([\d.]+)\s*\|/;

const parseHexDecimal = (value: Undef<string>) => value ? +('0x' + value.padEnd(8, 'F')) : null;

const Image = new class extends Module implements functions.IImage {
    public jpegQuality = 100;

    isJpeg(filename: string, mimeType?: string, filepath?: string) {
        if (mimeType && mimeType.endsWith('image/jpeg')) {
            return true;
        }
        switch (path.extname(filepath || filename).toLowerCase()) {
            case '.jpg':
            case '.jpeg':
                return true;
            default:
                return false;
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
        return match ? Math.min(Math.max(+match[1], 0), 1) : 1;
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
    resize(instance: jimp, options: ResizeData) {
        const { width, height, color } = options;
        if (color !== null) {
            instance.background(color);
        }
        switch (options.mode) {
            case 'contain':
                return instance.contain(width, height, options.align);
            case 'cover':
                return instance.cover(width, height, options.align);
            case 'scale':
                return instance.scaleToFit(width, height);
            default:
                return instance.resize(width === Infinity ? jimp.AUTO : width, height === Infinity ? jimp.AUTO : height, options.algorithm);
        }
    }
    crop(instance: jimp, options: CropData) {
        return instance.crop(options.x, options.y, options.width, options.height);
    }
    opacity(instance: jimp, value: number) {
        return instance.opacity(value);
    }
    rotate(instance: jimp, options: RotateData, filepath: string, preRotate?: () => void, postWrite?: (result?: unknown) => void) {
        const { values, color } = options;
        if (color !== null) {
            instance.background(color);
        }
        const deg = values[0];
        for (let i = 1, length = values.length; i < length; ++i) {
            const value = values[i];
            if (preRotate) {
                preRotate();
            }
            const img = instance.clone().rotate(value);
            const index = filepath.lastIndexOf('.');
            let output = filepath.substring(0, index) + '.' + value + filepath.substring(index);
            img.write(output, err => {
                if (err) {
                    this.writeFail(output, err);
                    output = '';
                }
                if (postWrite) {
                    postWrite(output);
                }
            });
        }
        return deg ? instance.rotate(deg) : instance;
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Image;
    module.exports.default = Image;
    module.exports.__esModule = true;
}

export default Image;