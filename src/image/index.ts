import type { IImage, Internal } from '../types/lib';

import Module from '../module';

type ResizeData = Internal.Image.ResizeData;
type CropData = Internal.Image.CropData;
type RotateData = Internal.Image.RotateData;
type QualityData = Internal.Image.QualityData;

const parseHexDecimal = (value: Undef<string>) => value ? +('0x' + value.padEnd(8, 'F')) : NaN;

abstract class Image extends Module implements IImage {
    public abstract readonly moduleName: string;

    parseCrop(value: string) {
        const match = /\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*\|\s*(\d+)\s*x\s*(\d+)\s*\)/.exec(value);
        if (match) {
            return { x: +match[1], y: +match[2], width: +match[3], height: +match[4] } as CropData;
        }
    }
    parseOpacity(value: string) {
        const match = /\|\s*(\d*\.\d+)\s*\|/.exec(value);
        if (match) {
            const opacity = +match[1];
            if (opacity >= 0 && opacity < 1) {
                return opacity;
            }
        }
        return NaN;
    }
    parseQuality(value: string) {
        const match = /\|\s*(\d+)(?:\s*\[\s*(photo|picture|drawing|icon|text)\s*\])?(?:\s*\[\s*(\d+)\s*\])?\s*\|/.exec(value);
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
        const match = /\(\s*(\d+|auto)\s*x\s*(\d+|auto)(?:\s*\[\s*(bilinear|bicubic|hermite|bezier)\s*\])?(?:\s*\^\s*(contain|cover|scale)(?:\s*\[\s*(left|center|right)?(?:\s*\|?\s*(top|middle|bottom))?\s*\])?)?(?:\s*#\s*([A-Fa-f\d]{1,8}))?\s*\)/.exec(value);
        if (match) {
            return { width: match[1] === 'auto' ? Infinity : +match[1], height: match[2] === 'auto' ? Infinity : +match[2], mode: match[4] || 'resize', algorithm: match[3], align: [match[5], match[6]], color: parseHexDecimal(match[7]) } as ResizeData;
        }
    }
    parseRotate(value: string) {
        const match = /\{\s*([\d\s,]+)(?:\s*#\s*([A-Fa-f\d]{1,8}))?\s*\}/.exec(value);
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
        const result: string[] = [];
        const pattern = /!\s*([A-Za-z$][\w$]*)/g;
        let match: Null<RegExpExecArray>;
        while (match = pattern.exec(value)) {
            result.push(match[1]);
        }
        if (result.length) {
            return result;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Image;
    module.exports.default = Image;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Image;