import type { IFileManager, IImage } from '../types/lib';
import type { FileData } from '../types/lib/asset';
import type { CropData, QualityData, ResizeData, RotateData } from '../types/lib/image';

import Module from '../module';

const parseHexDecimal = (value: Undef<string>) => value ? +('0x' + value.padEnd(8, 'F')) : NaN;

abstract class Image extends Module implements IImage {
    static using(this: IFileManager, data: FileData, command: string) {}

    static async transform(uri: string, command: string, mimeType?: string, tempFile?: boolean): Promise<Null<Buffer> | string> {
        return tempFile ? '' : null;
    }

    static parseFormat(value: string) { return ['', '']; }

    static clamp(value: Undef<string>, min = 0, max = 1) {
        return value ? Math.min(Math.max(min, +value), max) : NaN;
    }

    resizeData?: ResizeData;
    cropData?: CropData;
    rotateData?: RotateData;
    qualityData?: QualityData;
    methodData?: string[];
    opacityValue = NaN;

    abstract readonly moduleName: string;

    private _command = '';

    reset() {
        this.setCommand('');
    }
    setCommand(value: string) {
        this.resizeData = this.parseResize(value ||= '');
        this.cropData = this.parseCrop(value);
        this.rotateData = this.parseRotate(value);
        this.qualityData = this.parseQuality(value);
        this.opacityValue = this.parseOpacity(value);
        this.methodData = this.parseMethod(value);
        this._command = value;
    }
    getCommand() {
        return this._command;
    }
    parseCrop(value: string) {
        const match = /\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*\|\s*(\d+)\s*x\s*(\d+)\s*\)/.exec(value);
        if (match) {
            return { x: +match[1], y: +match[2], width: +match[3], height: +match[4] } as CropData;
        }
    }
    parseOpacity(value: string) {
        const match = /\|\s*(\d*\.\d+)\s*\|/.exec(value);
        return match ? Image.clamp(match[1]) : NaN;
    }
    parseQuality(value: string) {
        const match = /\|\s*(\d+)(?:\s*\[\s*(photo|picture|drawing|icon|text)\s*\])?(?:\s*\[\s*(\d+)\s*\])?\s*\|/.exec(value);
        if (match) {
            return { value: Image.clamp(match[1], 0, 100), preset: match[2], nearLossless: Image.clamp(match[3], 0, 100) } as QualityData;
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