import type { IFileManager } from '../../types/lib';
import type { ExternalAsset, FileData, OutputData } from '../../types/lib/asset';

import type { IJimpImageHandler } from './image';

import path = require('path');
import fs = require('fs');
import child_process = require('child_process');
import jimp = require('jimp');

import Image from '../index';

const MODULE_NAME = 'jimp';
const METHOD_ALIAS: StringMap = {
    ct: 'contain',
    cv: 'cover',
    re: 'resize',
    sc: 'scale',
    sf: 'scaleToFit',
    au: 'autocrop',
    cr: 'crop',
    bt: 'blit',
    cp: 'composite',
    ma: 'mask',
    cl: 'convolute',
    fl: 'flip',
    mi: 'mirror',
    ro: 'rotate',
    br: 'brightness',
    cn: 'contrast',
    dt: 'dither565',
    gr: 'greyscale',
    in: 'invert',
    no: 'normalize',
    fa: 'fade',
    op: 'opacity',
    oq: 'opaque',
    bg: 'background',
    ga: 'gaussian',
    bl: 'blur',
    po: 'posterize',
    se: 'sepia',
    px: 'pixelate',
    dp: 'displace',
    co: 'color'
};
const MIME_INPUT = new Set([jimp.MIME_PNG, jimp.MIME_JPEG, jimp.MIME_BMP, jimp.MIME_GIF, jimp.MIME_TIFF, 'image/webp']);
const MIME_OUTPUT = new Set([jimp.MIME_PNG, jimp.MIME_JPEG, jimp.MIME_BMP, 'image/webp']);

function performCommand(localUri: string | Buffer, command: string, outputType: string, finalAs?: string, host?: IFileManager, data?: FileData) {
    return jimp.read(localUri as string)
        .then(async img => {
            const handler = new Jimp(img);
            handler.setCommand(command, finalAs);
            await handler.method();
            handler.resize();
            handler.crop();
            if (outputType === jimp.MIME_JPEG && !finalAs) {
                handler.quality();
            }
            else {
                handler.opacity();
            }
            if (host && data && handler.rotateCount > 1) {
                await handler.rotate(host.getLocalUri(data), (err, result) => {
                    if (!err) {
                        host.add(result, data.file);
                    }
                });
            }
            else {
                handler.rotate();
            }
            return handler;
        });
}

const getBuffer = (data: FileData) => (data.file.buffer as unknown) as string || data.file.localUri!;

class Jimp extends Image implements IJimpImageHandler<jimp> {
    static using(this: IFileManager, data: FileData, command: string) {
        const localUri = this.getLocalUri(data);
        const mimeType = this.getMimeType(data);
        if (!localUri || !mimeType || !MIME_INPUT.has(mimeType)) {
            return;
        }
        const [outputType, saveAs, finalAs] = Jimp.parseFormat(command, mimeType);
        if (!outputType) {
            return;
        }
        data.command = command;
        data.outputType = outputType;
        const output = this.addCopy(data, saveAs, command.indexOf('@') !== -1);
        if (!output) {
            return;
        }
        this.performAsyncTask();
        const transformBuffer = (tempFile?: string) => {
            this.formatMessage(this.logType.PROCESS, MODULE_NAME, ['Transforming image...', path.basename(localUri)], command);
            const time = Date.now();
            performCommand(tempFile || getBuffer(data), command, outputType, finalAs, this, data)
                .then(handler => {
                    if (command.indexOf('@') !== -1) {
                        delete data.file.buffer;
                    }
                    this.subProcesses.add(handler);
                    handler.write(output, (err: Null<Error>, result: string) => {
                        let parent: Undef<ExternalAsset>;
                        if (!err && result) {
                            const file = data.file;
                            if (file.document) {
                                this.writeImage(file.document, { ...data, command, output: result, baseDirectory: this.baseDirectory } as OutputData);
                            }
                            this.writeTimeProcess(handler.moduleName, path.basename(result), time);
                            if (this.getLocalUri(data) !== result) {
                                if (command.indexOf('%') !== -1) {
                                    if (this.filesToCompare.has(file)) {
                                        this.filesToCompare.get(file)!.push(result);
                                    }
                                    else {
                                        this.filesToCompare.set(file, [result]);
                                    }
                                    result = '';
                                }
                                else if (command.indexOf('@') !== -1) {
                                    this.replace(file, result);
                                    result = '';
                                }
                                else {
                                    parent = file;
                                }
                            }
                        }
                        else {
                            handler.writeFail(['Unable to finalize image', result], err);
                            result = '';
                        }
                        this.completeAsyncTask(null, result, parent);
                    });
                })
                .catch(err => this.writeFail(['Unable to read image buffer', MODULE_NAME + path.basename(localUri)], err, this.logType.FILE));
        };
        if (mimeType === 'image/webp') {
            try {
                const tempFile = this.getTempDir(false, '.bmp');
                child_process.execFile(require('dwebp-bin'), [`"${localUri}"`, '-mt', '-bmp', '-o', tempFile], { shell: true }, err => {
                    if (!err) {
                        transformBuffer(tempFile);
                    }
                    else {
                        this.writeFail(['Unable to convert image buffer', localUri], err);
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
            transformBuffer();
        }
    }

    static transform(uri: string, command: string, mimeType?: string, tempFile?: boolean) {
        const [outputType, saveAs, finalAs] = this.parseFormat(command, mimeType);
        if (outputType) {
            return performCommand(uri, command, outputType, finalAs).then(handler => handler.getBuffer(tempFile, saveAs, finalAs)).catch(() => tempFile ? '' : null);
        }
        return super.transform(uri, command, mimeType, tempFile);
    }

    static parseFormat(command: string, mimeType?: string): [string, string, string] {
        command = command.trim().toLowerCase();
        for (let mime of MIME_OUTPUT) {
            let saveAs = mime.split('/')[1];
            if (command.startsWith(saveAs)) {
                let finalAs = '';
                switch (saveAs) {
                    case 'jpeg':
                        saveAs = 'jpg';
                        break;
                    case 'webp':
                        if (mimeType === jimp.MIME_JPEG) {
                            mime = jimp.MIME_JPEG;
                            saveAs = 'jpg';
                        }
                        else {
                            mime = jimp.MIME_PNG;
                            saveAs = 'png';
                        }
                        finalAs = 'webp';
                        break;
                }
                return [mime, saveAs, finalAs];
            }
        }
        return ['', '', ''];
    }

    moduleName = MODULE_NAME;

    private _finalAs: Undef<string> = '';

    constructor(public instance: jimp) {
        super();
    }

    reset() {
        super.reset();
        this._finalAs = '';
    }
    setCommand(value: string, finalAs?: string) {
        super.setCommand(value);
        this._finalAs = finalAs;
    }
    async method() {
        if (this.methodData) {
            for (const [name, args = []] of this.methodData) {
                const alias = METHOD_ALIAS[name] || name;
                switch (alias) {
                    case 'contain':
                    case 'cover':
                    case 'resize':
                    case 'scale':
                    case 'scaleToFit':
                    case 'autocrop':
                    case 'crop':
                    case 'blit':
                    case 'composite':
                    case 'mask':
                    case 'convolute':
                    case 'flip':
                    case 'mirror':
                    case 'rotate':
                    case 'brightness':
                    case 'contrast':
                    case 'dither565':
                    case 'greyscale':
                    case 'invert':
                    case 'normalize':
                    case 'fade':
                    case 'opacity':
                    case 'opaque':
                    case 'background':
                    case 'gaussian':
                    case 'blur':
                    case 'posterize':
                    case 'sepia':
                    case 'pixelate':
                    case 'displace':
                    case 'color':
                        try {
                            this.instance = await (this.instance[alias] as FunctionType<jimp>)(...args);
                        }
                        catch (err) {
                            this.writeFail(['Invalid method arguments', MODULE_NAME + ':' + name], err);
                        }
                        break;
                    default:
                        this.writeFail(['Unable to locate method', MODULE_NAME + ':' + name], new Error(`Method "${name}" (Unknown)`));
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
    rotate(pathFile?: string, callback?: StandardCallback<string>): Void<Promise<unknown>[]> {
        const tasks: Promise<unknown>[] = [];
        if (this.rotateData) {
            const { values, color } = this.rotateData;
            if (!isNaN(color)) {
                this.instance = this.instance.background(color);
            }
            const length = values.length;
            const deg = values[0];
            if (length > 1 && pathFile) {
                pathFile = Image.renameExt(pathFile, '::');
                for (let i = 1; i < length; ++i) {
                    const value = values[i];
                    const img = this.instance.clone().rotate(value);
                    const output = pathFile.replace('::', value.toString());
                    tasks.push(
                        img.writeAsync(output)
                            .then(() => {
                                this.finalize(output, (err: Null<Error>, result: string) => {
                                    if (callback) {
                                        callback(err, result);
                                    }
                                });
                            })
                            .catch(err => this.writeFail(['Unable to rotate image', this.moduleName], err))
                    );
                }
            }
            if (deg) {
                this.instance = this.instance.rotate(deg);
            }
        }
        if (tasks.length) {
            return tasks;
        }
    }
    write(output: string, callback?: StandardCallback<string>) {
        this.instance.write(output, err => {
            if (!err) {
                this.finalize(output, (error: Null<Error>, result: string) => {
                    if (callback) {
                        callback(error, error ? '' : result);
                    }
                });
            }
            else if (callback) {
                callback(err, '');
            }
        });
    }
    getBuffer(tempFile?: boolean, saveAs?: string, finalAs?: string) {
        const output = this.getTempDir(false, '.' + (finalAs || (saveAs && MIME_OUTPUT.has('image/' + (saveAs === 'jpg' ? 'jpeg' : saveAs)) ? saveAs : this.instance.getMIME().split('/').pop()!)));
        return new Promise<Null<Buffer | string>>(resolve => {
            this.instance.write(output, err => {
                if (!err) {
                    this.finalize(output, (err_1: Null<Error>, result: string) => {
                        if (!err_1) {
                            if (tempFile) {
                                resolve(output);
                            }
                            else {
                                try {
                                    resolve(fs.readFileSync(result));
                                }
                                catch (err_2) {
                                    resolve(null);
                                    this.writeFail(['Unable to read file', result], err_2, this.logType.FILE);
                                }
                                try {
                                    fs.unlinkSync(result);
                                }
                                catch (err_2) {
                                    this.writeFail(['Unable to delete file', result], err_2, this.logType.FILE);
                                }
                            }
                        }
                        else {
                            resolve(tempFile ? '' : null);
                        }
                    }, finalAs);
                }
                else {
                    resolve(tempFile ? '' : null);
                }
            });
        });
    }
    finalize(output: string, callback: (err: Null<Error>, result: string) => void, finalAs?: string) {
        if (this._finalAs === 'webp' || finalAs === 'webp') {
            const webp = Image.renameExt(output, 'webp');
            const args = [`"${output}"`, '-mt', '-m', '6'];
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
            child_process.execFile(require('cwebp-bin'), args, { shell: true }, err => {
                if (err) {
                    this.writeFail(['Install WebP?', 'npm i cwebp-bin'], err);
                    callback(err, output);
                }
                else if (webp !== output) {
                    fs.unlink(output, err_1 => {
                        if (err_1) {
                            this.writeFail(['Unable to delete file', output], err_1, this.logType.FILE);
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
    get rotateCount() {
        return this.rotateData ? this.rotateData.values.length : 0;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Jimp;
    module.exports.default = Jimp;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Jimp;