import type { Response } from 'express';

import path = require('path');
import fs = require('fs-extra');
import util = require('util');
import request = require('request');
import jimp = require('jimp');
import tinify = require('tinify');

import Module from '../module';
import Node from '../node';
import Compress from '../compress';
import Image from '../image';
import Chrome from '../chrome';

type WriteTask = (file: string, data: any) => Promise<void>;

const readFile = util.promisify(fs.readFile);
const appendFile = util.promisify(fs.appendFile) as WriteTask;
const writeFile = util.promisify(fs.writeFile) as WriteTask;

export default class extends Module implements functions.IFileManager {
    public static loadSettings(value: functions.Settings) {
        const {
            disk_read,
            disk_write,
            unc_read,
            unc_write,
            gzip_level,
            brotli_quality,
            jpeg_quality,
            tinypng_api_key
        } = value;

        if (disk_read === true || disk_read === 'true') {
            Node.enableReadDisk();
        }
        if (disk_write === true || disk_write === 'true') {
            Node.enableWriteDisk();
        }
        if (unc_read === true || unc_read === 'true') {
            Node.enableReadUNC();
        }
        if (unc_write === true || unc_write === 'true') {
            Node.enableWriteUNC();
        }

        const gzip = parseInt(gzip_level as string);
        const brotli = parseInt(brotli_quality as string);
        const jpeg = parseInt(jpeg_quality as string);

        if (!isNaN(gzip)) {
            Compress.gzipLevel = gzip;
        }
        if (!isNaN(brotli)) {
            Compress.brotliQuality = brotli;
        }
        if (!isNaN(jpeg)) {
            Image.jpegQuality = jpeg;
        }

        if (tinypng_api_key) {
            tinify.key = tinypng_api_key;
            tinify.validate(err => {
                if (!err) {
                    Compress.tinifyApiKey = tinypng_api_key;
                }
            });
        }
    }

    public static moduleNode() {
        return Node;
    }

    public static moduleCompress() {
        return Compress;
    }

    public static moduleImage() {
        return Image;
    }

    public static moduleChrome() {
        return Chrome;
    }

    public static checkPermissions(res: Response, dirname: string) {
        if (Node.isDirectoryUNC(dirname)) {
            if (!Node.canWriteUNC()) {
                res.json({ application: 'OPTION: --unc-write', system: 'Writing to UNC shares is not enabled.' });
                return false;
            }
        }
        else if (!Node.canWriteDisk()) {
            res.json({ application: 'OPTION: --disk-write', system: 'Writing to disk is not enabled.' });
            return false;
        }
        try {
            if (!fs.existsSync(dirname)) {
                fs.mkdirpSync(dirname);
            }
            else if (!fs.lstatSync(dirname).isDirectory()) {
                throw new Error('Root is not a directory.');
            }
        }
        catch (system) {
            res.json({ application: `DIRECTORY: ${dirname}`, system });
            return false;
        }
        return true;
    }

    public serverRoot = '__serverroot__';
    public delayed = 0;
    public cleared = false;
    public emptyDirectory = false;
    public productionRelease = false;
    public readonly files = new Set<string>();
    public readonly filesQueued = new Set<string>();
    public readonly filesToRemove = new Set<string>();
    public readonly filesToCompare = new Map<functions.ExpressAsset, string[]>();
    public readonly contentToAppend = new Map<string, string[]>();
    public readonly postFinalize: (this: functions.IFileManager) => void;
    public readonly requestMain?: functions.ExpressAsset;
    public readonly dataMap?: functions.DataMap;

    constructor(
        public readonly dirname: string,
        public readonly assets: functions.ExpressAsset[],
        postFinalize: (this: functions.IFileManager) => void)
    {
        super();
        this.requestMain = assets.find(item => item.requestMain);
        this.dataMap = assets[0].dataMap;
        this.postFinalize = postFinalize.bind(this);
    }

    add(value: string) {
        this.files.add(value.substring(this.dirname.length + 1));
    }
    delete(value: string) {
        this.files.delete(value.substring(this.dirname.length + 1));
    }
    performAsyncTask() {
        ++this.delayed;
    }
    removeAsyncTask() {
        --this.delayed;
    }
    completeAsyncTask(filepath?: string) {
        if (this.delayed !== Infinity) {
            if (filepath) {
                this.add(filepath);
            }
            this.removeAsyncTask();
            this.performFinalize();
        }
    }
    performFinalize() {
        if (this.cleared && this.delayed <= 0) {
            this.delayed = Infinity;
            this.finalizeAssets().then(() => this.postFinalize());
        }
    }
    replace(file: functions.ExpressAsset, replaceWith: string) {
        const filepath = file.filepath;
        if (filepath) {
            if (replaceWith.includes('__copy__') && path.extname(filepath) === path.extname(replaceWith)) {
                try {
                    fs.renameSync(replaceWith, filepath);
                }
                catch (err) {
                    this.writeFail(replaceWith, err);
                }
            }
            else {
                this.filesToRemove.add(filepath);
                this.delete(filepath);
                file.originalName ||= file.filename;
                file.filename = path.basename(replaceWith);
                this.add(replaceWith);
            }
        }
    }
    validate(file: functions.ExpressAsset, exclusions: Exclusions) {
        const pathname = file.pathname.replace(/[\\/]$/, '');
        const filename = file.filename;
        const winOS = path.sep === '/' ? '' : 'i';
        if (exclusions.pathname) {
            for (const value of exclusions.pathname) {
                const directory = value.trim().replace(/[\\/]/g, '[\\\\/]').replace(/[\\/]$/, '');
                if (new RegExp(`^${directory}$`, winOS).test(pathname) || new RegExp(`^${directory}[\\\\/]`, winOS).test(pathname)) {
                    return false;
                }
            }
        }
        if (exclusions.filename) {
            for (const value of exclusions.filename) {
                if (value === filename || winOS && value.toLowerCase() === filename.toLowerCase()) {
                    return false;
                }
            }
        }
        if (exclusions.extension) {
            const ext = path.extname(filename).substring(1).toLowerCase();
            for (const value of exclusions.extension) {
                if (ext === value.toLowerCase()) {
                    return false;
                }
            }
        }
        if (exclusions.pattern) {
            const filepath = path.join(pathname, filename);
            const filepath_opposing = winOS ? filepath.replace(/\\/g, '/') : filepath.replace(/\//g, '\\');
            for (const value of exclusions.pattern) {
                const pattern = new RegExp(value);
                if (pattern.test(filepath) || pattern.test(filepath_opposing)) {
                    return false;
                }
            }
        }
        return true;
    }
    getFileOutput(file: functions.ExpressAsset) {
        const pathname = path.join(this.dirname, file.moveTo || '', file.pathname);
        const filepath = path.join(pathname, file.filename);
        file.filepath = filepath;
        return { pathname, filepath };
    }
    getRelativeUrl(file: functions.ExpressAsset, url: string) {
        let asset = this.assets.find(item => item.uri === url),
            origin = file.uri;
        if (!asset && origin) {
            const location = Node.resolvePath(url, origin);
            if (location) {
                asset = this.assets.find(item => item.uri === location);
            }
        }
        if (asset && asset.uri) {
            const { serverRoot, requestMain } = this;
            if (requestMain) {
                origin = Node.resolvePath(path.join(file.moveTo !== serverRoot && file.rootDir || '', file.pathname, file.filename), requestMain.uri!);
            }
            if (origin && Node.fromSameOrigin(origin, asset.uri)) {
                const rootDir = asset.rootDir;
                const baseDir = (file.rootDir || '') + file.pathname;
                if (asset.moveTo === serverRoot) {
                    if (file.moveTo === serverRoot) {
                        return path.join(asset.pathname, asset.filename).replace(/\\/g, '/');
                    }
                    else if (requestMain) {
                        const mainUri = requestMain.uri;
                        if (mainUri && Node.fromSameOrigin(origin, mainUri)) {
                            const [originDir] = this.getRootDirectory(baseDir + '/' + file.filename, Node.parsePath(mainUri)!);
                            return '../'.repeat(originDir.length - 1) + this.getFullUri(asset);
                        }
                    }
                }
                else if (rootDir) {
                    if (baseDir === rootDir + asset.pathname) {
                        return asset.filename;
                    }
                    else if (baseDir === rootDir) {
                        return path.join(asset.pathname, asset.filename).replace(/\\/g, '/');
                    }
                }
                else {
                    const [originDir, uriDir] = this.getRootDirectory(Node.parsePath(origin)!, Node.parsePath(asset.uri)!);
                    return '../'.repeat(originDir.length - 1) + uriDir.join('/');
                }
            }
        }
    }
    getAbsoluteUrl(value: string, href: string) {
        value = value.replace(/\\/g, '/');
        let moveTo = '';
        if (value[0] === '/') {
            moveTo = this.serverRoot;
        }
        else if (value.startsWith('../')) {
            moveTo = this.serverRoot;
            value = Node.resolvePath(value, href, false) || ('/' + value.replace(/\.\.\//g, ''));
        }
        else if (value.startsWith('./')) {
            value = value.substring(2);
        }
        return moveTo + value;
    }
    getRootDirectory(location: string, asset: string): [string[], string[]] {
        const locationDir = location.split(/[\\/]/);
        const assetDir = asset.split(/[\\/]/);
        while (locationDir.length && assetDir.length && locationDir[0] === assetDir[0]) {
            locationDir.shift();
            assetDir.shift();
        }
        return [locationDir, assetDir];
    }
    getFullUri(file: functions.ExpressAsset, filename = file.filename) {
        return path.join(file.moveTo || '', file.pathname, filename).replace(/\\/g, '/');
    }
    replacePath(source: string, segment: string, value: string, base64?: boolean) {
        segment = !base64 ? segment.replace(/[\\/]/g, '[\\\\/]') : '[^"\',]+,\\s*' + segment;
        let output: Undef<string>,
            pattern = new RegExp(`([sS][rR][cC]|[hH][rR][eE][fF]|[dD][aA][tT][aA]|[pP][oO][sS][tT][eE][rR]=)?(["'])(\\s*)${segment}(\\s*)\\2`, 'g'),
            match: Null<RegExpExecArray>;
        while (match = pattern.exec(source)) {
            output = (output || source).replace(match[0], match[1] ? match[1].toLowerCase() + `"${value}"` : match[2] + match[3] + value + match[4] + match[2]);
        }
        pattern = new RegExp(`[uU][rR][lL]\\(\\s*(["'])?\\s*${segment}\\s*\\1?\\s*\\)`, 'g');
        while (match = pattern.exec(source)) {
            output = (output || source).replace(match[0], `url(${value})`);
        }
        return output;
    }
    replaceExtension(value: string, ext: string) {
        const index = value.lastIndexOf('.');
        return value.substring(0, index !== -1 ? index : value.length) + '.' + ext;
    }
    async appendContent(file: functions.ExpressAsset, content: string, outputOnly?: boolean) {
        const filepath = file.filepath || this.getFileOutput(file).filepath;
        if (filepath && file.bundleIndex !== undefined) {
            const { mimeType, format } = file;
            if (mimeType) {
                if (mimeType.endsWith('text/css')) {
                    if (!file.preserve) {
                        const unusedStyles = this.dataMap?.unusedStyles;
                        if (unusedStyles) {
                            const result = Chrome.removeCss(content, unusedStyles);
                            if (result) {
                                content = result;
                            }
                        }
                    }
                    if (mimeType[0] === '@') {
                        const result = this.transformCss(file, content);
                        if (result) {
                            content = result;
                        }
                    }
                }
                if (format) {
                    const result = await Chrome.formatContent(mimeType, format, content, this.dataMap?.transpileMap);
                    if (result) {
                        content = result;
                    }
                }
            }
            const trailing = await this.getTrailingContent(file);
            if (trailing) {
                content += trailing;
            }
            if (outputOnly || file.bundleIndex === 0) {
                return Promise.resolve(content);
            }
            const items = this.contentToAppend.get(filepath) || [];
            items.splice(file.bundleIndex - 1, 0, content);
            this.contentToAppend.set(filepath, items);
        }
        return Promise.resolve('');
    }
    async getTrailingContent(file: functions.ExpressAsset) {
        const trailingContent = file.trailingContent;
        let output = '';
        if (trailingContent) {
            let unusedStyles: Undef<string[]>,
                transpileMap: Undef<functions.TranspileMap>;
            if (this.dataMap) {
                ({ unusedStyles, transpileMap } = this.dataMap);
            }
            const mimeType = file.mimeType;
            for (const item of trailingContent) {
                let value = item.value;
                if (mimeType) {
                    if (mimeType.endsWith('text/css')) {
                        if (unusedStyles && !item.preserve) {
                            const result = Chrome.removeCss(value, unusedStyles);
                            if (result) {
                                value = result;
                            }
                        }
                        if (mimeType[0] === '@') {
                            const result = this.transformCss(file, value);
                            if (result) {
                                value = result;
                            }
                        }
                    }
                    if (item.format) {
                        const result = await Chrome.formatContent(mimeType, item.format, value, transpileMap);
                        if (result) {
                            output += '\n' + result;
                            continue;
                        }
                    }
                }
                output += '\n' + value;
            }
        }
        return Promise.resolve(output);
    }
    async transformBuffer(assets: functions.ExpressAsset[], file: functions.ExpressAsset, filepath: string) {
        const mimeType = file.mimeType;
        if (!mimeType || mimeType[0] === '&') {
            return Promise.resolve();
        }
        const format = file.format;
        const transpileMap = this.dataMap?.transpileMap;
        switch (mimeType) {
            case '@text/html':
            case '@application/xhtml+xml': {
                const minifySpace = (value: string) => value.replace(/\s+/g, '');
                const getOuterHTML = (script: boolean, value: string) => script ? `<script type="text/javascript" src="${value}"></script>` : `<link rel="stylesheet" type="text/css" href="${value}" />`;
                const baseUri = file.uri!;
                const saved = new Set<string>();
                let html = fs.readFileSync(filepath, 'utf8'),
                    source = html,
                    pattern = /(\s*)<(script|link|style)[^>]*?(\s+data-chrome-file="\s*(save|export)As:\s*((?:[^"]|\\")+)")[^>]*>(?:[\s\S]*?<\/\2>\n*)?/ig,
                    match: Null<RegExpExecArray>;
                while (match = pattern.exec(html)) {
                    const segment = match[0];
                    const script = match[2].toLowerCase() === 'script';
                    const location = this.getAbsoluteUrl(match[5].split('::')[0].trim(), baseUri);
                    if (saved.has(location) || match[4] === 'export' && new RegExp(`<${script ? 'script' : 'link'}[^>]+?(?:${script ? 'src' : 'href'}=(["'])${location}\\1|data-chrome-file="saveAs:${location}[:"])[^>]*>`, 'i').test(html)) {
                        source = source.replace(segment, '');
                    }
                    else if (match[4] === 'save') {
                        const content = segment.replace(match[3], '');
                        const src = new RegExp(`\\s+${script ? 'src' : 'href'}="(?:[^"]|\\\\")+"`, 'i').exec(content) || new RegExp(`\\s+${script ? 'src' : 'href'}='(?:[^']|\\\\')+'`, 'i').exec(content);
                        if (src) {
                            source = source.replace(segment, content.replace(src[0], `${script ? ' src' : ' href'}="${location}"`));
                            saved.add(location);
                        }
                    }
                    else {
                        source = source.replace(segment, match[1] + getOuterHTML(script, location));
                        saved.add(location);
                    }
                }
                html = source;
                pattern = /(\s*)<(script|style)[^>]*>([\s\S]*?)<\/\2>\n*/ig;
                for (const item of assets) {
                    if (item.excluded) {
                        continue;
                    }
                    const { bundleIndex, trailingContent } = item;
                    if (bundleIndex !== undefined) {
                        const outerHTML = item.outerHTML;
                        if (outerHTML) {
                            let replaceWith = '',
                                replaced: string;
                            if (bundleIndex === 0 || bundleIndex === Infinity) {
                                replaceWith = getOuterHTML(item.mimeType === 'text/javascript', this.getFullUri(item));
                                replaced = source.replace(outerHTML, replaceWith);
                            }
                            else {
                                replaced = source.replace(new RegExp(`\\s*${outerHTML}\\n*`), '');
                            }
                            if (replaced === source) {
                                const content = item.content && minifySpace(item.content);
                                const outerContent = minifySpace(outerHTML);
                                while (match = pattern.exec(html)) {
                                    if (outerContent === minifySpace(match[0]) || content && content === minifySpace(match[3])) {
                                        source = source.replace(match[0], (replaceWith ? match[1] : '') + replaceWith);
                                        break;
                                    }
                                }
                                pattern.lastIndex = 0;
                            }
                            else {
                                source = replaced;
                            }
                            html = source;
                        }
                    }
                    if (trailingContent) {
                        const content = trailingContent.map(trailing => minifySpace(trailing.value));
                        while (match = pattern.exec(html)) {
                            if (content.includes(minifySpace(match[3]))) {
                                source = source.replace(match[0], '');
                            }
                        }
                        html = source;
                        pattern.lastIndex = 0;
                    }
                }
                for (const item of assets) {
                    if (item.excluded) {
                        continue;
                    }
                    if (item.base64) {
                        const replaced = this.replacePath(source, item.base64.replace(/\+/g, '\\+'), this.getFullUri(item), true);
                        if (replaced) {
                            source = replaced;
                            html = source;
                        }
                        continue;
                    }
                    else if (item === file || item.content || !item.uri) {
                        continue;
                    }
                    const value = this.getFullUri(item);
                    if (item.rootDir || Node.fromSameOrigin(baseUri, item.uri)) {
                        pattern = new RegExp(`(["'\\s,=])(((?:\\.\\.)?(?:[\\\\/]\\.\\.|\\.\\.[\\\\/]|[\\\\/])*)?${path.join(item.pathname, item.filename).replace(/[\\/]/g, '[\\\\/]')})`, 'g');
                        while (match = pattern.exec(html)) {
                            if (match[2] !== value && item.uri === Node.resolvePath(match[2], baseUri)) {
                                source = source.replace(match[0], match[1] + value);
                            }
                        }
                    }
                    const replaced = this.replacePath(source, item.uri, value);
                    if (replaced) {
                        source = replaced;
                    }
                    html = source;
                }
                source = source
                    .replace(/\s*<(script|link|style)[^>]+?data-chrome-file="exclude"[^>]*>[\s\S]*?<\/\1>\n*/ig, '')
                    .replace(/\s*<script[^>]*?data-chrome-template="([^"]|\\")+?"[^>]*>[\s\S]*?<\/script>\n*/ig, '')
                    .replace(/\s*<(script|link)[^>]+?data-chrome-file="exclude"[^>]*>\n*/ig, '')
                    .replace(/\s+data-(?:use|chrome-[\w-]+)="([^"]|\\")+?"/g, '');
                fs.writeFileSync(filepath, format && await Chrome.minifyHtml(format, source, transpileMap) || source);
                break;
            }
            case 'text/html':
            case 'application/xhtml+xml': {
                if (format) {
                    const result = await Chrome.minifyHtml(format, fs.readFileSync(filepath, 'utf8'), transpileMap);
                    if (result) {
                        fs.writeFileSync(filepath, result);
                    }
                }
                break;
            }
            case 'text/css':
            case '@text/css': {
                const unusedStyles = file.preserve !== true && this.dataMap?.unusedStyles;
                const transforming = mimeType[0] === '@';
                const trailing = await this.getTrailingContent(file);
                if (!unusedStyles && !transforming && !format) {
                    if (trailing) {
                        try {
                            fs.appendFileSync(filepath, trailing);
                        }
                        catch (err) {
                            this.writeFail(filepath, err);
                        }
                    }
                    break;
                }
                const content = fs.readFileSync(filepath, 'utf8');
                let source: Undef<string>;
                if (unusedStyles) {
                    const result = Chrome.removeCss(content, unusedStyles);
                    if (result) {
                        source = result;
                    }
                }
                if (transforming) {
                    const result = this.transformCss(file, source || content);
                    if (result) {
                        source = result;
                    }
                }
                if (format) {
                    const result = await Chrome.minifyCss(format, source || content, transpileMap);
                    if (result) {
                        source = result;
                    }
                }
                if (trailing) {
                    if (source) {
                        source += trailing;
                    }
                    else {
                        source = content + trailing;
                    }
                }
                if (source) {
                    try {
                        fs.writeFileSync(filepath, source);
                    }
                    catch (err) {
                        this.writeFail(filepath, err);
                    }
                }
                break;
            }
            case 'text/javascript':
            case '@text/javascript': {
                const trailing = await this.getTrailingContent(file);
                if (!format) {
                    if (trailing) {
                        try {
                            fs.appendFileSync(filepath, trailing);
                        }
                        catch (err) {
                            this.writeFail(filepath, err);
                        }
                    }
                    break;
                }
                const content = fs.readFileSync(filepath, 'utf8');
                let source: Undef<string>;
                if (format) {
                    const result = await Chrome.minifyJs(format, content, transpileMap);
                    if (result) {
                        source = result;
                    }
                }
                if (trailing) {
                    if (source) {
                        source += trailing;
                    }
                    else {
                        source = content + trailing;
                    }
                }
                if (source) {
                    try {
                        fs.writeFileSync(filepath, source);
                    }
                    catch (err) {
                        this.writeFail(filepath, err);
                    }
                }
                break;
            }
            default:
                if (mimeType.includes('image/')) {
                    const afterConvert = (transformed: string, condition: string) => {
                        if (filepath !== transformed) {
                            if (condition.includes('@')) {
                                this.replace(file, transformed);
                            }
                            else if (condition.includes('%')) {
                                if (this.filesToCompare.has(file)) {
                                    this.filesToCompare.get(file)!.push(transformed);
                                }
                                else {
                                    this.filesToCompare.set(file, [transformed]);
                                }
                            }
                        }
                    };
                    const compressImage = (location: string) => {
                        try {
                            tinify.fromBuffer(fs.readFileSync(location)).toBuffer((err, resultData) => {
                                if (!err && resultData) {
                                    fs.writeFileSync(location, resultData);
                                }
                                this.completeAsyncTask(filepath !== location ? location : '');
                            });
                        }
                        catch (err) {
                            this.completeAsyncTask(filepath !== location ? location : '');
                            this.writeFail(location, err);
                            tinify.validate();
                        }
                    };
                    if (mimeType === 'image/unknown') {
                        this.performAsyncTask();
                        jimp.read(filepath)
                            .then(img => {
                                const mime = img.getMIME();
                                switch (mime) {
                                    case jimp.MIME_PNG:
                                    case jimp.MIME_JPEG:
                                    case jimp.MIME_BMP:
                                    case jimp.MIME_GIF:
                                    case jimp.MIME_TIFF:
                                        try {
                                            const renameTo = this.replaceExtension(filepath, mime.split('/')[1]);
                                            fs.renameSync(filepath, renameTo);
                                            afterConvert(renameTo, '@');
                                            if ((mime === jimp.MIME_PNG || mime === jimp.MIME_JPEG) && Compress.findCompress(file.compress)) {
                                                compressImage(renameTo);
                                            }
                                            else {
                                                this.completeAsyncTask(renameTo);
                                            }
                                        }
                                        catch (err) {
                                            this.completeAsyncTask();
                                            this.writeFail(filepath, err);
                                        }
                                        break;
                                    default: {
                                        const png = this.replaceExtension(filepath, 'png');
                                        img.write(png, err => {
                                            if (err) {
                                                this.completeAsyncTask();
                                                this.writeFail(png, err);
                                            }
                                            else {
                                                afterConvert(png, '@');
                                                if (Compress.findCompress(file.compress)) {
                                                    compressImage(png);
                                                }
                                                else {
                                                    this.completeAsyncTask(png);
                                                }
                                            }
                                        });
                                    }
                                }
                            })
                            .catch(err => {
                                this.completeAsyncTask();
                                this.writeFail(filepath, err);
                            });
                    }
                    else {
                        const convert = mimeType.split(':');
                        --convert.length;
                        for (const value of convert) {
                            if (!Compress.withinSizeRange(filepath, value)) {
                                continue;
                            }
                            const resizeMode = Image.parseResizeMode(value);
                            const opacity = Image.parseOpacity(value);
                            const rotation = Image.parseRotation(value);
                            let image = filepath;
                            const setImagePath = (extension: string, saveAs?: string) => {
                                if (mimeType.endsWith('/' + extension)) {
                                    if (!value.includes('@')) {
                                        let i = 1;
                                        do {
                                            image = this.replaceExtension(filepath, '__copy__.' + (i > 1 ? `(${i}).` : '') + (saveAs || extension));
                                        }
                                        while (this.filesQueued.has(image) && ++i);
                                        fs.copyFileSync(filepath, image);
                                    }
                                }
                                else {
                                    let i = 1;
                                    do {
                                        image = this.replaceExtension(filepath, (i > 1 ? `(${i}).` : '') + (saveAs || extension));
                                    }
                                    while (this.filesQueued.has(image) && ++i);
                                }
                                this.filesQueued.add(image);
                            };
                            if (value.startsWith('png')) {
                                this.performAsyncTask();
                                jimp.read(filepath)
                                    .then(img => {
                                        setImagePath('png');
                                        if (resizeMode) {
                                            Image.resize(img, resizeMode.width, resizeMode.height, resizeMode.mode);
                                        }
                                        if (opacity) {
                                            Image.opacity(img, opacity);
                                        }
                                        if (rotation) {
                                            Image.rotate(img, image, rotation, this);
                                        }
                                        img.write(image, err => {
                                            if (err) {
                                                this.completeAsyncTask();
                                                this.writeFail(image, err);
                                            }
                                            else {
                                                afterConvert(image, value);
                                                if (Compress.findCompress(file.compress)) {
                                                    compressImage(image);
                                                }
                                                else {
                                                    this.completeAsyncTask(filepath !== image ? image : '');
                                                }
                                            }
                                        });
                                    })
                                    .catch(err => {
                                        this.completeAsyncTask();
                                        this.writeFail(filepath, err);
                                    });
                            }
                            else if (value.startsWith('jpeg')) {
                                this.performAsyncTask();
                                jimp.read(filepath)
                                    .then(img => {
                                        setImagePath('jpeg', 'jpg');
                                        img.quality(Image.jpegQuality);
                                        if (resizeMode) {
                                            Image.resize(img, resizeMode.width, resizeMode.height, resizeMode.mode);
                                        }
                                        if (rotation) {
                                            Image.rotate(img, image, rotation, this);
                                        }
                                        img.write(image, err => {
                                            if (err) {
                                                this.completeAsyncTask();
                                                this.writeFail(image, err);
                                            }
                                            else {
                                                afterConvert(image, value);
                                                if (Compress.findCompress(file.compress)) {
                                                    compressImage(image);
                                                }
                                                else {
                                                    this.completeAsyncTask(filepath !== image ? image : '');
                                                }
                                            }
                                        });
                                    })
                                    .catch(err => {
                                        this.completeAsyncTask();
                                        this.writeFail(filepath, err);
                                    });
                            }
                            else if (value.startsWith('bmp')) {
                                this.performAsyncTask();
                                jimp.read(filepath)
                                    .then(img => {
                                        setImagePath('bmp');
                                        if (resizeMode) {
                                            Image.resize(img, resizeMode.width, resizeMode.height, resizeMode.mode);
                                        }
                                        if (opacity) {
                                            Image.opacity(img, opacity);
                                        }
                                        if (rotation) {
                                            Image.rotate(img, image, rotation, this);
                                        }
                                        img.write(image, err => {
                                            if (err) {
                                                this.completeAsyncTask();
                                                this.writeFail(image, err);
                                            }
                                            else {
                                                afterConvert(image, value);
                                                this.completeAsyncTask(filepath !== image ? image : '');
                                            }
                                        });
                                    })
                                    .catch(err => {
                                        this.completeAsyncTask();
                                        this.writeFail(filepath, err);
                                    });
                            }
                        }
                    }
                }
                break;
        }
        return Promise.resolve();
    }
    compressFile(assets: functions.ExpressAsset[], file: functions.ExpressAsset, filepath: string, cached?: boolean) {
        const compress = file.compress;
        const jpeg = Image.isJpeg(file.filename, file.mimeType, filepath) && Compress.findFormat(compress, 'jpeg');
        const resumeThread = () => {
            this.transformBuffer(assets, file, filepath).then(() => {
                const gzip = Compress.findFormat(compress, 'gz');
                const brotli = Compress.findFormat(compress, 'br');
                if (gzip && Compress.withinSizeRange(filepath, gzip.condition)) {
                    this.performAsyncTask();
                    let gz = `${filepath}.gz`;
                    Compress.createWriteStreamAsGzip(filepath, gz, gzip.level)
                        .on('finish', () => {
                            if (gzip.condition?.includes('%') && this.getFileSize(gz) >= this.getFileSize(filepath)) {
                                try {
                                    fs.unlinkSync(gz);
                                }
                                catch {
                                }
                                gz = '';
                            }
                            this.completeAsyncTask(gz);
                        })
                        .on('error', err => {
                            this.writeFail(gz, err);
                            this.completeAsyncTask();
                        });
                }
                if (brotli && Node.checkVersion(11, 7) && Compress.withinSizeRange(filepath, brotli.condition)) {
                    this.performAsyncTask();
                    let br = `${filepath}.br`;
                    Compress.createWriteStreamAsBrotli(filepath, br, brotli.level, file.mimeType)
                        .on('finish', () => {
                            if (brotli.condition?.includes('%') && this.getFileSize(br) >= this.getFileSize(filepath)) {
                                try {
                                    fs.unlinkSync(br);
                                }
                                catch {
                                }
                                br = '';
                            }
                            this.completeAsyncTask(br);
                        })
                        .on('error', err => {
                            this.writeFail(br, err);
                            this.completeAsyncTask();
                        });
                }
                this.completeAsyncTask(!cached ? filepath : '');
            });
        };
        if (jpeg && Compress.withinSizeRange(filepath, jpeg.condition)) {
            this.performAsyncTask();
            const jpg = filepath + (jpeg.condition?.includes('%') ? '.jpg' : '');
            jimp.read(filepath)
                .then(image => {
                    image.quality(jpeg.level ?? Image.jpegQuality).write(jpg, err => {
                        if (err) {
                            this.writeFail(filepath, err);
                        }
                        else if (jpg !== filepath) {
                            try {
                                if (this.getFileSize(jpg) >= this.getFileSize(filepath)) {
                                    fs.unlinkSync(jpg);
                                }
                                else {
                                    fs.renameSync(jpg, filepath);
                                }
                            }
                            catch {
                            }
                        }
                        this.completeAsyncTask();
                        resumeThread();
                    });
                })
                .catch(err => {
                    this.writeFail(filepath, err);
                    this.completeAsyncTask();
                    resumeThread();
                });
        }
        else {
            resumeThread();
        }
    }
    transformCss(file: functions.ExpressAsset, content: string) {
        const baseUrl = file.uri!;
        if (this.requestMain && Node.fromSameOrigin(this.requestMain.uri!, baseUrl)) {
            const assets = this.assets;
            for (const item of assets) {
                if (item.base64 && item.uri && !item.excluded) {
                    const url = this.getRelativeUrl(file, item.uri);
                    if (url) {
                        const replacement = this.replacePath(content, item.base64.replace(/\+/g, '\\+'), url, true);
                        if (replacement) {
                            content = replacement;
                        }
                    }
                }
            }
            const pattern = /url\(\s*([^)]+)\s*\)/ig;
            let output: Undef<string>,
                match: Null<RegExpExecArray>;
            while (match = pattern.exec(content)) {
                const url = match[1].replace(/^["']\s*/, '').replace(/\s*["']$/, '');
                if (!Node.isFileURI(url) || Node.fromSameOrigin(baseUrl, url)) {
                    let location = this.getRelativeUrl(file, url);
                    if (location) {
                        output = (output || content).replace(match[0], `url(${location})`);
                    }
                    else {
                        location = Node.resolvePath(url, this.requestMain.uri!);
                        if (location) {
                            const asset = assets.find(item => item.uri === location && !item.excluded);
                            if (asset) {
                                location = this.getRelativeUrl(file, location);
                                if (location) {
                                    output = (output || content).replace(match[0], `url(${location})`);
                                }
                            }
                        }
                    }
                }
                else {
                    const asset = assets.find(item => item.uri === url && !item.excluded);
                    if (asset) {
                        const count = file.pathname.split(/[\\/]/).length;
                        output = (output || content).replace(match[0], `url(${(count ? '../'.repeat(count) : '') + this.getFullUri(asset)})`);
                    }
                }
            }
            return output;
        }
    }
    writeBuffer(assets: functions.ExpressAsset[], file: functions.ExpressAsset, filepath: string, cached?: boolean) {
        const png = Compress.findCompress(file.compress);
        if (png && Compress.withinSizeRange(filepath, png.condition)) {
            try {
                tinify.fromBuffer(fs.readFileSync(filepath)).toBuffer((err, resultData) => {
                    if (!err && resultData) {
                        fs.writeFileSync(filepath, resultData);
                    }
                    if (Image.isJpeg(file.filename, file.mimeType)) {
                        Compress.removeFormat(file.compress, 'jpeg');
                    }
                    this.compressFile(assets, file, filepath, cached);
                });
            }
            catch (err) {
                this.compressFile(assets, file, filepath, cached);
                this.writeFail(filepath, err);
                tinify.validate();
            }
        }
        else {
            this.compressFile(assets, file, filepath, cached);
        }
    }
    processAssets() {
        const emptyDir = new Set<string>();
        const notFound: ObjectMap<boolean> = {};
        const processing: ObjectMap<functions.ExpressAsset[]> = {};
        const appending: ObjectMap<functions.ExpressAsset[]> = {};
        const completed: string[] = [];
        const assets = this.assets;
        const exclusions = assets[0].exclusions;
        const checkQueue = (file: functions.ExpressAsset, filepath: string, content?: boolean) => {
            const bundleIndex = file.bundleIndex;
            if (bundleIndex !== undefined) {
                appending[filepath] ||= [];
                if (bundleIndex > 0) {
                    appending[filepath][bundleIndex - 1] = file;
                    return true;
                }
            }
            else if (!content) {
                if (completed.includes(filepath)) {
                    this.writeBuffer(assets, file, filepath, true);
                    return true;
                }
                else {
                    const queue = processing[filepath];
                    if (queue) {
                        this.performAsyncTask();
                        queue.push(file);
                        return true;
                    }
                    else {
                        processing[filepath] = [file];
                    }
                }
            }
            return false;
        };
        const processQueue = async (file: functions.ExpressAsset, filepath: string, bundleMain?: functions.ExpressAsset) => {
            const bundleIndex = file.bundleIndex;
            if (bundleIndex !== undefined) {
                if (bundleIndex === 0) {
                    if (this.getFileSize(filepath) && !file.excluded) {
                        const content = await this.appendContent(file, fs.readFileSync(filepath, 'utf8'), true);
                        if (content) {
                            try {
                                fs.writeFileSync(filepath, content, 'utf8');
                            }
                            catch (err) {
                                this.writeFail(filepath, err);
                            }
                        }
                    }
                    else {
                        file.excluded = true;
                        const content = await this.getTrailingContent(file);
                        if (content) {
                            try {
                                fs.writeFileSync(filepath, content, 'utf8');
                                file.excluded = false;
                            }
                            catch (err) {
                                this.writeFail(filepath, err);
                            }
                        }
                    }
                }
                const items = appending[filepath];
                if (items) {
                    while (items.length) {
                        const queue = items.shift();
                        if (queue) {
                            const uri = queue.uri;
                            const verifyBundle = async (value: string) => {
                                if (this.getFileSize(filepath)) {
                                    return this.appendContent(queue, value);
                                }
                                const content = await this.appendContent(queue, value, true);
                                if (content) {
                                    try {
                                        fs.writeFileSync(filepath, content, 'utf8');
                                        queue.bundleIndex = Infinity;
                                        bundleMain = queue;
                                    }
                                    catch (err) {
                                        queue.excluded = true;
                                        this.writeFail(filepath, err);
                                    }
                                }
                                return Promise.resolve();
                            };
                            const resumeQueue = () => processQueue(queue, filepath, !bundleMain || bundleMain.excluded ? !file.excluded && file || queue : bundleMain);
                            if (queue.content) {
                                verifyBundle(queue.content).then(resumeQueue);
                            }
                            else if (uri) {
                                request(uri, (err, response) => {
                                    if (err) {
                                        notFound[uri] = true;
                                        queue.excluded = true;
                                        this.writeFail(uri, err);
                                        resumeQueue();
                                    }
                                    else {
                                        const statusCode = response.statusCode;
                                        if (statusCode >= 300) {
                                            notFound[uri] = true;
                                            queue.excluded = true;
                                            this.writeFail(uri, statusCode + ' ' + response.statusMessage);
                                            resumeQueue();
                                        }
                                        else {
                                            verifyBundle(response.body).then(resumeQueue);
                                        }
                                    }
                                });
                            }
                            else {
                                resumeQueue();
                            }
                            return;
                        }
                    }
                }
                if (this.getFileSize(filepath)) {
                    this.compressFile(assets, bundleMain || file, filepath);
                    this.completeAsyncTask(filepath);
                }
                else {
                    (bundleMain || file).excluded = true;
                    this.completeAsyncTask();
                }
            }
            else if (Array.isArray(processing[filepath])) {
                completed.push(filepath);
                for (const item of processing[filepath]) {
                    if (item.excluded) {
                        this.completeAsyncTask();
                    }
                    else {
                        this.writeBuffer(assets, item, filepath);
                    }
                }
                delete processing[filepath];
            }
            else {
                this.writeBuffer(assets, file, filepath);
            }
        };
        const errorRequest = (file: functions.ExpressAsset, filepath: string, message: Error | string, stream?: fs.WriteStream) => {
            const uri = file.uri!;
            if (!notFound[uri]) {
                if (appending[filepath]?.length) {
                    processQueue(file, filepath);
                }
                else {
                    this.completeAsyncTask();
                }
                notFound[uri] = true;
            }
            if (stream) {
                try {
                    stream.close();
                    fs.unlinkSync(filepath);
                }
                catch {
                }
            }
            file.excluded = true;
            this.writeFail(uri, message);
            delete processing[filepath];
        };
        for (const file of assets) {
            if (exclusions && !this.validate(file, exclusions)) {
                file.excluded = true;
                continue;
            }
            const { pathname, filepath } = this.getFileOutput(file);
            const fileReceived = (err: NodeJS.ErrnoException) => {
                if (err) {
                    file.excluded = true;
                }
                if (!err || appending[filepath]?.length) {
                    processQueue(file, filepath);
                }
                else {
                    this.completeAsyncTask();
                }
            };
            if (!emptyDir.has(pathname)) {
                if (this.emptyDirectory) {
                    try {
                        fs.emptyDirSync(pathname);
                    }
                    catch (err) {
                        this.writeFail(pathname, err);
                    }
                }
                if (!fs.existsSync(pathname)) {
                    try {
                        fs.mkdirpSync(pathname);
                    }
                    catch (err) {
                        file.excluded = true;
                        this.writeFail(pathname, err);
                    }
                }
                emptyDir.add(pathname);
            }
            if (file.content) {
                if (checkQueue(file, filepath, true)) {
                    continue;
                }
                this.performAsyncTask();
                fs.writeFile(
                    filepath,
                    file.content,
                    'utf8',
                    err => fileReceived(err)
                );
            }
            else if (file.base64) {
                this.performAsyncTask();
                fs.writeFile(
                    filepath,
                    file.base64,
                    'base64',
                    err => {
                        if (!err) {
                            this.writeBuffer(assets, file, filepath);
                        }
                        else {
                            file.excluded = true;
                            this.completeAsyncTask();
                        }
                    }
                );
            }
            else {
                const uri = file.uri;
                if (!uri || notFound[uri]) {
                    file.excluded = true;
                    continue;
                }
                try {
                    if (Node.isFileURI(uri)) {
                        if (checkQueue(file, filepath)) {
                            continue;
                        }
                        const stream = fs.createWriteStream(filepath);
                        stream.on('finish', () => {
                            if (!notFound[uri]) {
                                processQueue(file, filepath);
                            }
                        });
                        this.performAsyncTask();
                        request(uri)
                            .on('response', response => {
                                const statusCode = response.statusCode;
                                if (statusCode >= 300) {
                                    errorRequest(file, filepath, statusCode + ' ' + response.statusMessage, stream);
                                }
                            })
                            .on('error', err => errorRequest(file, filepath, err, stream))
                            .pipe(stream);
                    }
                    else if (Node.canReadUNC() && Node.isFileUNC(uri)) {
                        if (checkQueue(file, filepath)) {
                            continue;
                        }
                        this.performAsyncTask();
                        fs.copyFile(
                            uri,
                            filepath,
                            err => fileReceived(err)
                        );
                    }
                    else if (Node.canReadDisk() && path.isAbsolute(uri)) {
                        if (checkQueue(file, filepath)) {
                            continue;
                        }
                        this.performAsyncTask();
                        fs.copyFile(
                            uri,
                            filepath,
                            err => fileReceived(err)
                        );
                    }
                    else {
                        file.excluded = true;
                    }
                }
                catch (err) {
                    errorRequest(file, filepath, err);
                }
            }
        }
        this.cleared = true;
        this.performFinalize();
    }
    async finalizeAssets() {
        const filesToRemove = this.filesToRemove;
        for (const [file, output] of this.filesToCompare) {
            const originalPath = file.filepath!;
            let minFile = originalPath,
                minSize = this.getFileSize(minFile);
            for (const transformed of output) {
                const size = this.getFileSize(transformed);
                if (size > 0 && size < minSize) {
                    filesToRemove.add(minFile);
                    minFile = transformed;
                    minSize = size;
                }
                else {
                    filesToRemove.add(transformed);
                }
            }
            if (minFile !== originalPath) {
                this.replace(file, minFile);
            }
        }
        const length = this.dirname.length;
        for (const value of this.filesToRemove) {
            this.files.delete(value.substring(length + 1));
            try {
                if (fs.existsSync(value)) {
                    fs.unlinkSync(value);
                }
            }
            catch (err) {
                this.writeFail(value, err);
            }
        }
        let tasks: Promise<void>[] = [];
        for (const [filepath, content] of this.contentToAppend.entries()) {
            let output = '';
            for (const value of content) {
                if (value) {
                    output += '\n' + value;
                }
            }
            tasks.push((fs.existsSync(filepath) ? appendFile : writeFile)(filepath, output));
        }
        if (tasks.length) {
            await Promise.all(tasks);
            tasks = [];
        }
        const replaced = this.assets.filter(item => item.originalName);
        if (replaced.length || this.productionRelease) {
            for (const item of this.assets) {
                if (item.excluded) {
                    continue;
                }
                const { filepath, mimeType } = item;
                if (filepath) {
                    switch (mimeType) {
                        case '@text/html':
                        case '@application/xhtml+xml':
                        case '@text/css':
                        case '&text/css':
                            tasks.push(
                                readFile(filepath).then((data: Buffer) => {
                                    let html = data.toString('utf-8');
                                    for (const asset of replaced) {
                                        html = html.replace(new RegExp(this.getFullUri(asset, asset.originalName).replace(/[\\/]/g, '[\\\\/]'), 'g'), this.getFullUri(asset));
                                    }
                                    if (this.productionRelease) {
                                        html = html.replace(/(\.\.\/)*__serverroot__/g, '');
                                    }
                                    fs.writeFileSync(filepath, html);
                                })
                            );
                            break;
                    }
                }
            }
        }
        return tasks.length ? Promise.all(tasks) : Promise.resolve([]);
    }
}