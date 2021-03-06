import type { IFileManager, IImage } from '../types/lib';
import type { FileProcessing } from '../types/lib/asset';
import type { CropData, QualityData, ResizeData, RotateData, TransformOptions } from '../types/lib/image';

import Module from '../module';

const enum METHOD_ARGTYPE { // eslint-disable-line no-shadow
    ARRAY = 1,
    OBJECT = 2,
    STRING = 3,
    NUMBER = 4
}

const REGEXP_CROP = /\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*\|\s*(\d+)\s*[xX]\s*(\d+)\s*\)/;
const REGEXP_OPACITY = /\|\s*(\d*\.\d+)\s*\|/;
const REGEXP_QUALITY = /\|\s*(\d+)(?:\s*\[\s*(photo|picture|drawing|icon|text)\s*\])?(?:\s*\[\s*(\d+)\s*\])?\s*\|/i;
const REGEXP_RESIZE = /\(\s*(\d+|auto)\s*x\s*(\d+|auto)(?:\s*\[\s*(bilinear|bicubic|hermite|bezier)\s*\])?(?:\s*\^\s*(contain|cover|scale)(?:\s*\[\s*(left|center|right)?(?:\s*\|?\s*(top|middle|bottom))?\s*\])?)?(?:\s*#\s*([A-Fa-f\d]{1,8}))?\s*\)/i;
const REGEXP_ROTATE = /\{\s*([\d\s,]+)(?:\s*#\s*([A-Fa-f\d]{1,8}))?\s*\}/;
const REGEXP_METHOD = /!\s*([A-Za-z$][\w$]*)(\()?/g;

const isNumber = (ch: string) => ch >= '0' && ch <= '9';
const parseHexDecimal = (value: Undef<string>) => value ? +('0x' + value.padEnd(8, 'F')) : NaN;

abstract class Image extends Module implements IImage {
    static using(this: IFileManager, data: FileProcessing, command: string) {}

    static transform(uri: string, command: string, options?: TransformOptions): Promise<Null<Buffer> | string> {
        return Promise.resolve(options && options.tempFile ? '' : null);
    }

    static parseFormat(value: string) { return ['', '']; }

    static clamp(value: Undef<string>, min = 0, max = 1) {
        return value ? Math.min(Math.max(min, +value), max) : NaN;
    }

    resizeData?: ResizeData;
    cropData?: CropData;
    rotateData?: RotateData;
    qualityData?: QualityData;
    methodData?: [string, unknown[]?][];
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
        const match = REGEXP_CROP.exec(value);
        if (match) {
            return { x: +match[1], y: +match[2], width: +match[3], height: +match[4] } as CropData;
        }
    }
    parseOpacity(value: string) {
        const match = REGEXP_OPACITY.exec(value);
        return match ? Image.clamp(match[1]) : NaN;
    }
    parseQuality(value: string) {
        const match = REGEXP_QUALITY.exec(value);
        if (match) {
            return { value: Image.clamp(match[1], 0, 100), preset: match[2], nearLossless: Image.clamp(match[3], 0, 100) } as QualityData;
        }
    }
    parseResize(value: string) {
        const match = REGEXP_RESIZE.exec(value);
        if (match) {
            return { width: match[1] === 'auto' ? Infinity : +match[1], height: match[2] === 'auto' ? Infinity : +match[2], mode: match[4] || 'resize', algorithm: match[3], align: [match[5], match[6]], color: parseHexDecimal(match[7]) } as ResizeData;
        }
    }
    parseRotate(value: string) {
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
        const result: [string, unknown[]?][] = [];
        let match: Null<RegExpExecArray>;
        while (match = REGEXP_METHOD.exec(value)) {
            if (match[2]) {
                let i = match.index + match[0].length;
                invalid: {
                    const args: unknown[] = [];
                    let valid = false,
                        type = 0,
                        next = true,
                        current = '',
                        stringType = '',
                        decimal = 0,
                        objectCount = 0,
                        arrayCount = 0;
                    const addArg = (item: unknown) => {
                        type = 0;
                        current = '';
                        next = false;
                        args.push(item);
                    };
                    const isEscaped = (checkQuote = true) => {
                        if (!checkQuote || /["']/.test(current)) {
                            let k = 0;
                            for (let j = current.length - 1; j >= 0; --j) {
                                if (current[j] === '\\') {
                                    ++k;
                                }
                            }
                            if (k % 2 === 1) {
                                return true;
                            }
                        }
                        return false;
                    };
                    found: {
                        for (const length = value.length; i < length; ++i) {
                            const ch = value[i];
                            switch (ch) {
                                case "'":
                                case '"':
                                    if (type === 0) {
                                        type = METHOD_ARGTYPE.STRING;
                                        stringType = ch;
                                        continue;
                                    }
                                    else if (type === METHOD_ARGTYPE.STRING && ch === stringType && !isEscaped(false)) {
                                        addArg(current);
                                        continue;
                                    }
                                    break;
                                case '[':
                                    if (type === 0) {
                                        type = METHOD_ARGTYPE.ARRAY;
                                        arrayCount = 1;
                                    }
                                    else if (type === METHOD_ARGTYPE.ARRAY && !isEscaped()) {
                                        ++arrayCount;
                                    }
                                    break;
                                case ']':
                                    if (type === METHOD_ARGTYPE.ARRAY && !isEscaped() && --arrayCount === 0) {
                                        try {
                                            addArg(JSON.parse(current + ']'));
                                            continue;
                                        }
                                        catch {
                                            break invalid;
                                        }
                                    }
                                    break;
                                case '{':
                                    if (type === 0) {
                                        type = METHOD_ARGTYPE.OBJECT;
                                        objectCount = 1;
                                    }
                                    else if (type === METHOD_ARGTYPE.OBJECT && !isEscaped()) {
                                        ++objectCount;
                                    }
                                    break;
                                case '}':
                                    if (type === METHOD_ARGTYPE.OBJECT && !isEscaped() && --objectCount === 0) {
                                        try {
                                            addArg(JSON.parse(current + '}'));
                                            continue;
                                        }
                                        catch {
                                            break invalid;
                                        }
                                    }
                                    break;
                            }
                            const isSpace = /\s/.test(ch);
                            if (type === 0) {
                                if (isSpace) {
                                    continue;
                                }
                                switch (ch) {
                                    case ')':
                                        valid = true;
                                        break found;
                                    case ',':
                                        if (!next) {
                                            next = true;
                                            continue;
                                        }
                                        break invalid;
                                    case 't':
                                        if (value.substring(i, i + 4) === 'true') {
                                            addArg(true);
                                            i += 3;
                                            continue;
                                        }
                                        break invalid;
                                    case 'f':
                                        if (value.substring(i, i + 5) === 'false') {
                                            addArg(false);
                                            i += 4;
                                            continue;
                                        }
                                        break invalid;
                                    case '-':
                                    case '+':
                                        if (isNumber(value[i + 1])) {
                                            type = METHOD_ARGTYPE.NUMBER;
                                            current += ch;
                                            continue;
                                        }
                                        break invalid;
                                    default:
                                        if (isNumber(ch)) {
                                            type = METHOD_ARGTYPE.NUMBER;
                                            current += ch;
                                            continue;
                                        }
                                        break invalid;
                                }
                            }
                            else if (!next) {
                                break invalid;
                            }
                            else {
                                if (type === METHOD_ARGTYPE.NUMBER && !(ch === '.' && decimal++ === 0)) {
                                    if (isSpace || ch === ',' || ch === ')') {
                                        addArg(+current);
                                        switch (ch) {
                                            case ')':
                                                valid = true;
                                                break found;
                                            case ',':
                                                next = true;
                                            default:
                                                continue;
                                        }
                                    }
                                    else if (!isNumber(ch)) {
                                        break invalid;
                                    }
                                }
                                current += ch;
                            }
                        }
                    }
                    if (valid) {
                        result.push([match[1], args]);
                    }
                }
                REGEXP_METHOD.lastIndex = i;
            }
            else {
                result.push([match[1]]);
            }
        }
        REGEXP_METHOD.lastIndex = 0;
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