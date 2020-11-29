import Module from '../module';

type IFileManager = functions.IFileManager;
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

abstract class Image extends Module implements functions.IImage {
    public static using(this: IFileManager, options: UsingOptions) {}

    public parseCrop(value: string) {
        const match = REGEXP_CROP.exec(value);
        if (match) {
            return { x: +match[1], y: +match[2], width: +match[3], height: +match[4] } as CropData;
        }
    }
    public parseOpacity(value: string) {
        const match = REGEXP_OPACITY.exec(value);
        if (match) {
            const opacity = +match[1];
            if (opacity >= 0 && opacity < 1) {
                return opacity;
            }
        }
        return NaN;
    }
    public parseQuality(value: string) {
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
    public parseResize(value: string) {
        const match = REGEXP_RESIZE.exec(value);
        if (match) {
            return { width: match[1] === 'auto' ? Infinity : +match[1], height: match[2] === 'auto' ? Infinity : +match[2], mode: match[4] || 'resize', algorithm: match[3], align: [match[5], match[6]], color: parseHexDecimal(match[7]) } as ResizeData;
        }
    }
    public parseRotation(value: string) {
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
    public parseMethod(value: string) {
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
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Image;
    module.exports.default = Image;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Image;