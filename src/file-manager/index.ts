import type { Response } from 'express';

import child_process = require('child_process');
import path = require('path');
import fs = require('fs-extra');
import request = require('request');
import uuid = require('uuid');
import mime = require('mime-types');
import escapeRegexp = require('escape-string-regexp');

import Module from '../module';
import Node from '../node';
import Compress from '../compress';
import Image from '../image';
import Chrome from '../chrome';

type DataMap = functions.chrome.DataMap;

type Settings = functions.Settings;
type ExpressAsset = functions.ExpressAsset;
type IFileManager = functions.IFileManager;

type FileData = functions.internal.FileData;
type FileOutput = functions.internal.FileOutput;
type CompressFormat = functions.squared.base.CompressFormat;

interface GulpData {
    gulpfile: string;
    items: string[];
}

interface GulpTask {
    task: string;
    origDir: string;
    data: GulpData;
}

const FileManager = class extends Module implements IFileManager {
    public static loadSettings(value: Settings, ignorePermissions?: boolean) {
        const { gzip_level, brotli_quality, tinypng_api_key, chrome } = value;
        const gzip = +(gzip_level as string);
        const brotli = +(brotli_quality as string);
        if (!isNaN(gzip)) {
            Compress.gzipLevel = gzip;
        }
        if (!isNaN(brotli)) {
            Compress.brotliQuality = brotli;
        }
        Compress.validate(tinypng_api_key);
        if (!ignorePermissions) {
            const { disk_read, disk_write, unc_read, unc_write } = value;
            if (disk_read === true || disk_read === 'true') {
                Node.enableDiskRead();
            }
            if (disk_write === true || disk_write === 'true') {
                Node.enableDiskWrite();
            }
            if (unc_read === true || unc_read === 'true') {
                Node.enableUNCRead();
            }
            if (unc_write === true || unc_write === 'true') {
                Node.enableUNCWrite();
            }
        }
        if (chrome) {
            Chrome.modules = chrome;
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

    public static checkPermissions(dirname: string, res?: Response) {
        if (Node.isDirectoryUNC(dirname)) {
            if (!Node.canWriteUNC()) {
                if (res) {
                    res.json({ application: 'OPTION: --unc-write', system: 'Writing to UNC shares is not enabled.' });
                }
                return false;
            }
        }
        else if (!Node.canWriteDisk()) {
            if (res) {
                res.json({ application: 'OPTION: --disk-write', system: 'Writing to disk is not enabled.' });
            }
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
            if (res) {
                res.json({ application: `DIRECTORY: ${dirname}`, system });
            }
            return false;
        }
        return true;
    }

    public serverRoot = '__serverroot__';
    public delayed = 0;
    public cleared = false;
    public emptyDirectory = false;
    public productionRelease = false;
    public Gulp?: StringMap;
    public readonly files = new Set<string>();
    public readonly filesQueued = new Set<string>();
    public readonly filesToRemove = new Set<string>();
    public readonly filesToCompare = new Map<ExpressAsset, string[]>();
    public readonly contentToAppend = new Map<string, string[]>();
    public readonly postFinalize: FunctionType<void>;
    public readonly dataMap: DataMap;
    public readonly baseAsset?: ExpressAsset;

    constructor(
        public readonly dirname: string,
        public readonly assets: ExpressAsset[],
        postFinalize: FunctionType<void>)
    {
        super();
        this.baseAsset = assets.find(item => item.basePath);
        this.dataMap = assets[0].dataMap || {};
        this.postFinalize = postFinalize.bind(this);
        assets.sort((a, b) => {
            if (a.commands && (!b.commands || a.textContent && !b.textContent) || b === this.baseAsset) {
                return -1;
            }
            if (b.commands && (!a.commands || !a.textContent && b.textContent) || a === this.baseAsset) {
                return 1;
            }
            return 0;
        });
    }

    install(name: string, ...args: any[]) {
        switch (name) {
            case 'gulp':
                if (typeof args[0] === 'object') {
                    this.Gulp = args[0] as StringMap;
                }
                break;
        }
    }
    add(value: string) {
        this.files.add(value.substring(this.dirname.length + 1));
    }
    delete(value: string) {
        this.files.delete(value.substring(this.dirname.length + 1));
    }
    replace(file: ExpressAsset, replaceWith: string) {
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
                file.originalName ||= file.filename;
                file.filename = path.basename(replaceWith);
                this.add(replaceWith);
            }
        }
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
    getHtmlPages(modified = true) {
        return this.assets.filter(item => {
            switch (item.mimeType) {
                case '@text/html':
                case '@application/xhtml+xml':
                    return modified;
                case 'text/html':
                case 'application/xhtml+xml':
                    return !modified;
                default:
                    return false;
            }
        });
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
    replacePath(source: string, segment: string, value: string, base64?: boolean) {
        segment = !base64 ? this.escapePathSeparator(segment) : '[^"\',]+,\\s*' + segment;
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
    escapePathSeparator(value: string) {
        return value.replace(/[\\/]/g, '[\\\\/]');
    }
    getFileOutput(file: ExpressAsset): FileOutput {
        const pathname = path.join(this.dirname, file.moveTo || '', file.pathname);
        const filepath = path.join(pathname, file.filename);
        file.filepath = filepath;
        return { pathname, filepath };
    }
    getRelativeUri(file: ExpressAsset, uri: string) {
        let asset = this.assets.find(item => item.uri === uri),
            origin = file.uri;
        if (!asset && origin) {
            const location = Node.resolvePath(uri, origin);
            if (location) {
                asset = this.assets.find(item => item.uri === location);
            }
        }
        if (asset && asset.uri) {
            const { serverRoot, baseAsset } = this;
            if (baseAsset) {
                origin = Node.resolvePath(path.join(file.moveTo !== serverRoot && file.rootDir || '', file.pathname, file.filename), baseAsset.uri!);
            }
            if (origin && Node.fromSameOrigin(origin, asset.uri)) {
                const rootDir = asset.rootDir;
                const baseDir = (file.rootDir || '') + file.pathname;
                if (asset.moveTo === serverRoot) {
                    if (file.moveTo === serverRoot) {
                        return Node.toPosixPath(path.join(asset.pathname, asset.filename));
                    }
                    else if (baseAsset) {
                        const mainUri = baseAsset.uri!;
                        if (Node.fromSameOrigin(origin, mainUri)) {
                            const [originDir] = this.getRootDirectory(baseDir + '/' + file.filename, Node.parsePath(mainUri)!);
                            return '../'.repeat(originDir.length - 1) + this.getFileUri(asset);
                        }
                    }
                }
                else if (rootDir) {
                    if (baseDir === rootDir + asset.pathname) {
                        return asset.filename;
                    }
                    else if (baseDir === rootDir) {
                        return Node.toPosixPath(path.join(asset.pathname, asset.filename));
                    }
                }
                else {
                    const [originDir, uriDir] = this.getRootDirectory(Node.parsePath(origin)!, Node.parsePath(asset.uri)!);
                    return '../'.repeat(originDir.length - 1) + uriDir.join('/');
                }
            }
        }
    }
    getAbsoluteUri(value: string, href: string) {
        value = Node.toPosixPath(value);
        let moveTo = '';
        if (value[0] === '/') {
            moveTo = this.serverRoot;
        }
        else if (value.startsWith('../')) {
            moveTo = this.serverRoot;
            value = Node.resolvePath(value, href, false) || ('/' + value.replace(/\.\.\//g, ''));
        }
        else if (value.startsWith('./')) {
            return value.substring(2);
        }
        return moveTo + value;
    }
    getFileUri(file: ExpressAsset, filename = file.filename) {
        return Node.toPosixPath(path.join(file.moveTo || '', file.pathname, filename));
    }
    getUTF8String(file: ExpressAsset, filepath?: string) {
        return file.sourceUTF8 ||= file.buffer?.toString('utf8') || fs.readFileSync(filepath || file.filepath!, 'utf8');
    }
    async appendContent(file: ExpressAsset, filepath: string, content: string, bundleIndex: number) {
        const { mimeType, format } = file;
        if (mimeType) {
            if (mimeType.endsWith('text/css')) {
                if (!file.preserve) {
                    if (this.dataMap.unusedStyles) {
                        const result = Chrome.removeCss(content, this.dataMap.unusedStyles);
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
                const result = await Chrome.formatContent(mimeType, format, content, this.dataMap.transpileMap);
                if (result) {
                    content = result;
                }
            }
        }
        const trailing = await this.getTrailingContent(file);
        if (trailing) {
            content += trailing;
        }
        if (bundleIndex === 0) {
            return Promise.resolve(content);
        }
        const items = this.contentToAppend.get(filepath) || [];
        items[bundleIndex - 1] = content;
        this.contentToAppend.set(filepath, items);
        return Promise.resolve('');
    }
    async getTrailingContent(file: ExpressAsset) {
        const trailingContent = file.trailingContent;
        let output = '';
        if (trailingContent) {
            const mimeType = file.mimeType;
            for (const item of trailingContent) {
                let value = item.value;
                if (mimeType) {
                    if (mimeType.endsWith('text/css')) {
                        if (!item.preserve && this.dataMap.unusedStyles) {
                            const result = Chrome.removeCss(value, this.dataMap.unusedStyles);
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
                        const result = await Chrome.formatContent(mimeType, item.format, value, this.dataMap.transpileMap);
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
    transformCss(file: ExpressAsset, content: string) {
        const baseUrl = file.uri!;
        if (this.baseAsset && Node.fromSameOrigin(this.baseAsset.uri!, baseUrl)) {
            const assets = this.assets;
            for (const item of assets) {
                if (item.base64 && item.uri && !item.invalid) {
                    const url = this.getRelativeUri(file, item.uri);
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
                    let location = this.getRelativeUri(file, url);
                    if (location) {
                        output = (output || content).replace(match[0], `url(${location})`);
                    }
                    else {
                        location = Node.resolvePath(url, this.baseAsset.uri!);
                        if (location) {
                            const asset = assets.find(item => item.uri === location && !item.invalid);
                            if (asset) {
                                location = this.getRelativeUri(file, location);
                                if (location) {
                                    output = (output || content).replace(match[0], `url(${location})`);
                                }
                            }
                        }
                    }
                }
                else {
                    const asset = assets.find(item => item.uri === url && !item.invalid);
                    if (asset) {
                        const count = file.pathname.split(/[\\/]/).length;
                        output = (output || content).replace(match[0], `url(${(count ? '../'.repeat(count) : '') + this.getFileUri(asset)})`);
                    }
                }
            }
            return output;
        }
    }
    async transformBuffer(data: FileData) {
        const { file, filepath } = data;
        const { format, mimeType } = file;
        if (!mimeType || mimeType[0] === '&') {
            return Promise.resolve();
        }
        switch (mimeType) {
            case '@text/html':
            case '@application/xhtml+xml': {
                const minifySpace = (value: string) => value.replace(/(\s+|\/)/g, '');
                const getOuterHTML = (css: boolean, value: string) => css ? `<link rel="stylesheet" href="${value}" />` : `<script src="${value}"></script>`;
                const baseUri = file.uri!;
                const saved = new Set<string>();
                let html = this.getUTF8String(file, filepath),
                    source = html,
                    pattern = /(\s*)<(script|link|style)[^>]*?(\s+data-chrome-file="\s*(save|export)As:\s*((?:[^"]|\\")+)")[^>]*>(?:[\s\S]*?<\/\2>\n*)?/ig,
                    match: Null<RegExpExecArray>;
                while (match = pattern.exec(html)) {
                    const items = match[5].split('::');
                    const uri = items[0].trim();
                    if (uri === '~') {
                        continue;
                    }
                    const location = this.getAbsoluteUri(uri, baseUri);
                    if (items[2] && items[2].includes('inline') && !saved.has(location)) {
                        saved.add(location);
                    }
                    else {
                        const script = match[2].toLowerCase() === 'script';
                        if (saved.has(location) || match[4] === 'export' && new RegExp(`<${script ? 'script' : 'link'}[^>]+?(?:${script ? 'src' : 'href'}=(["'])${location}\\1|data-chrome-file="saveAs:${location}[:"])[^>]*>`, 'i').test(html)) {
                            source = source.replace(match[0], '');
                        }
                        else if (match[4] === 'save') {
                            const content = match[0].replace(match[3], '');
                            const src = new RegExp(`\\s+${script ? 'src' : 'href'}="(?:[^"]|\\\\")+?"`, 'i').exec(content) || new RegExp(`\\s+${script ? 'src' : 'href'}='(?:[^']|\\\\')+?'`, 'i').exec(content);
                            if (src) {
                                source = source.replace(match[0], content.replace(src[0], `${script ? ' src' : ' href'}="${location}"`));
                                saved.add(location);
                            }
                        }
                        else {
                            source = source.replace(match[0], match[1] + getOuterHTML(!script, location));
                            saved.add(location);
                        }
                    }
                }
                html = source;
                pattern = /(\s*)<(script|style)[^>]*>([\s\S]*?)<\/\2>\n*/ig;
                for (const item of this.assets) {
                    if (item.invalid && !item.exclude) {
                        continue;
                    }
                    const { textContent, trailingContent } = item;
                    if (textContent) {
                        const { bundleIndex, inlineContent, attributes = [] } = item;
                        const replacing = source;
                        let output = '',
                            replaceWith = '';
                        const getAttribute = (name: string, value?: Null<string>) => value !== undefined ? name + (value !== null ? `="${value}"` : '') : '';
                        const formattedTag = () => textContent.replace(/">$/, '" />');
                        const replaceTry = () => {
                            source = source.replace(textContent, replaceWith);
                            if (replacing === source) {
                                source = source.replace(formattedTag(), replaceWith);
                            }
                        };
                        const replaceMinify = () => {
                            if (replacing === source) {
                                pattern.lastIndex = 0;
                                const content = item.content && minifySpace(item.content);
                                const outerContent = minifySpace(textContent);
                                while (match = pattern.exec(html)) {
                                    if (outerContent === minifySpace(match[0]) || content && content === minifySpace(match[3])) {
                                        source = source.replace(match[0], (replaceWith ? match[1] : '') + replaceWith);
                                        break;
                                    }
                                }
                            }
                            html = source;
                        };
                        if (inlineContent) {
                            const id = `<!-- ${uuid.v4()} -->`;
                            replaceWith = `<${inlineContent}${attributes ? attributes.map(({ name, value }) => getAttribute(name, value)).join('') : ''}>${id}</${inlineContent}>`;
                            replaceTry();
                            replaceMinify();
                            if (replacing !== source) {
                                item.inlineContent = id;
                                if (item.filepath) {
                                    this.filesToRemove.add(item.filepath);
                                }
                            }
                        }
                        else if (bundleIndex === 0 || bundleIndex === -1) {
                            output = getOuterHTML(/^\s*<link\b/i.test(textContent) || !!item.mimeType?.endsWith('/css'), this.getFileUri(item));
                        }
                        else if (item.exclude || bundleIndex !== undefined) {
                            source = source.replace(new RegExp(`\\s*${escapeRegexp(textContent)}\\n*`), '');
                            if (replacing === source) {
                                source = source.replace(new RegExp(`\\s*${escapeRegexp(formattedTag())}\\n*`), '');
                            }
                            replaceMinify();
                            continue;
                        }
                        if (attributes.length || output) {
                            output ||= textContent;
                            for (const { name, value } of attributes) {
                                match = new RegExp(`(\\s*)${name}(?:=(?:"([^"]|\\")*?"|'([^']|\\')*?')|\b)`).exec(output);
                                if (match) {
                                    output = output.replace(match[0], value !== undefined ? (match[1] ? ' ' : '') + getAttribute(name, value) : '');
                                }
                                else if (value !== undefined) {
                                    match = /^(\s*)<([\w-]+)(\s*)/.exec(output);
                                    if (match) {
                                        output = output.replace(match[0], match[1] + '<' + match[2] + ' ' + getAttribute(name, value) + (match[3] ? ' ' : ''));
                                    }
                                }
                            }
                            if (output !== textContent) {
                                replaceWith = output;
                                replaceTry();
                                replaceMinify();
                            }
                        }
                    }
                    if (trailingContent) {
                        pattern.lastIndex = 0;
                        const content = trailingContent.map(trailing => minifySpace(trailing.value));
                        while (match = pattern.exec(html)) {
                            if (content.includes(minifySpace(match[3]))) {
                                source = source.replace(match[0], '');
                            }
                        }
                        html = source;
                    }
                }
                for (const item of this.assets) {
                    if (item.invalid || item === file) {
                        continue;
                    }
                    let replaced: Undef<string>;
                    if (item.base64) {
                        replaced = this.replacePath(source, item.base64.replace(/\+/g, '\\+'), this.getFileUri(item), true);
                    }
                    else if (item.uri && !item.content) {
                        let value = this.getFileUri(item);
                        if (item.rootDir || Node.fromSameOrigin(baseUri, item.uri)) {
                            pattern = new RegExp(`(["'\\s,=])(((?:\\.\\.)?(?:[\\\\/]\\.\\.|\\.\\.[\\\\/]|[\\\\/])*)?${this.escapePathSeparator(path.join(item.pathname, item.filename))})`, 'g');
                            while (match = pattern.exec(html)) {
                                if (match[2] !== value && item.uri === Node.resolvePath(match[2], baseUri)) {
                                    source = source.replace(match[0], match[1] + value);
                                }
                            }
                        }
                        item.mimeType ||= mime.lookup(value).toString();
                        if (item.mimeType.startsWith('image/')) {
                            if (item.format === 'base64') {
                                value = uuid.v4();
                                item.inlineBase64 = value;
                            }
                            let textContent = item.textContent;
                            if (textContent) {
                                textContent = textContent.replace(/^\s*<\s*/, '').replace(/\s*\/?\s*>([\S\s]*<\/\w+>)?\s*$/, '');
                                replaced = this.replacePath(textContent, item.uri, value);
                                if (replaced) {
                                    const result = source.replace(textContent, replaced);
                                    if (result !== source) {
                                        source = result;
                                        html = result;
                                        continue;
                                    }
                                    replaced = '';
                                }
                            }
                        }
                        replaced ||= this.replacePath(source, item.uri, value);
                    }
                    if (replaced) {
                        source = replaced;
                        html = source;
                    }
                }
                source = source
                    .replace(/\s*<(script|link|style)[^>]+?data-chrome-file="exclude"[^>]*>[\s\S]*?<\/\1>\n*/ig, '')
                    .replace(/\s*<script[^>]*?data-chrome-template="([^"]|\\")+?"[^>]*>[\s\S]*?<\/script>\n*/ig, '')
                    .replace(/\s*<(script|link)[^>]+?data-chrome-file="exclude"[^>]*>\n*/ig, '')
                    .replace(/\s+data-(?:use|chrome-[\w-]+)="([^"]|\\")+?"/g, '');
                file.sourceUTF8 = format && await Chrome.minifyHtml(format, source, this.dataMap.transpileMap) || source;
                break;
            }
            case 'text/html':
            case 'application/xhtml+xml': {
                if (format) {
                    const result = await Chrome.minifyHtml(format, this.getUTF8String(file, filepath), this.dataMap.transpileMap);
                    if (result) {
                        file.sourceUTF8 = result;
                    }
                }
                break;
            }
            case 'text/css':
            case '@text/css': {
                const unusedStyles = file.preserve !== true && this.dataMap.unusedStyles;
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
                const content = this.getUTF8String(file, filepath);
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
                    const result = await Chrome.minifyCss(format, source || content, this.dataMap.transpileMap);
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
                    file.sourceUTF8 = source;
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
                const content = this.getUTF8String(file, filepath);
                let source: Undef<string>;
                if (format) {
                    const result = await Chrome.minifyJs(format, content, this.dataMap.transpileMap);
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
                    file.sourceUTF8 = source;
                }
                break;
            }
            default:
                if (mimeType.startsWith('image/')) {
                    let compress = Compress.hasImageService() ? Compress.findFormat(file.compress, 'png') : undefined;
                    if (compress && !Compress.withinSizeRange(filepath, compress.condition)) {
                        compress = undefined;
                    }
                    const callback = this.finalizeImage.bind(this);
                    if (mimeType === 'image/unknown') {
                        Image.using.call(this, { data, compress, callback });
                    }
                    else if (file.commands) {
                        for (const command of file.commands) {
                            if (Compress.withinSizeRange(filepath, command)) {
                                Image.using.call(this, { data, compress, command, callback });
                            }
                        }
                    }
                }
                break;
        }
        return Promise.resolve();
    }
    newImage(data: FileData, mimeType: string, outputType: string, saveAs: string, command = '') {
        const filepath = data.filepath;
        let output = '';
        if (mimeType === outputType) {
            if (!command.includes('@')) {
                let i = 1;
                do {
                    output = this.replaceExtension(filepath, '__copy__.' + (i > 1 ? `(${i}).` : '') + saveAs);
                }
                while (this.filesQueued.has(output) && ++i);
                fs.copyFileSync(filepath, output);
            }
        }
        else {
            let i = 1;
            do {
                output = this.replaceExtension(filepath, (i > 1 ? `(${i}).` : '') + saveAs);
            }
            while (this.filesQueued.has(output) && ++i);
        }
        if (output) {
            this.filesQueued.add(output);
        }
        return output || filepath;
    }
    replaceImage(data: FileData, output: string, command: string) {
        const { file, filepath } = data;
        if (filepath !== output) {
            if (command.includes('@')) {
                this.replace(file, output);
            }
            else if (command.includes('%')) {
                if (this.filesToCompare.has(file)) {
                    this.filesToCompare.get(file)!.push(output);
                }
                else {
                    this.filesToCompare.set(file, [output]);
                }
            }
        }
    }
    writeBuffer(data: FileData) {
        const filepath = data.filepath;
        const png = Compress.hasImageService() ? Compress.findFormat(data.file.compress, 'png') : undefined;
        if (png && Compress.withinSizeRange(filepath, png.condition)) {
            try {
                Compress.tryImage(filepath, (result: string, error: Null<Error>) => {
                    if (error) {
                        throw error;
                    }
                    data.filepath = result;
                    this.finalizeFile(data);
                });
            }
            catch (err) {
                this.writeFail(filepath, err);
                this.finalizeFile(data);
            }
        }
        else {
            this.finalizeFile(data);
        }
    }
    finalizeImage(data: FileData, output: string, command: string, compress?: CompressFormat, err?: Null<Error>) {
        if (err) {
            this.completeAsyncTask();
            this.writeFail(output, err);
        }
        else {
            this.replaceImage(data, output, command);
            if (compress) {
                try {
                    Compress.tryImage(output, (result: string, error: Null<Error>) => {
                        if (error) {
                            throw error;
                        }
                        this.completeAsyncTask(result);
                    });
                }
                catch (error) {
                    this.writeFail(output, error);
                    this.completeAsyncTask(output);
                }
            }
            else {
                this.completeAsyncTask(output);
            }
        }
    }
    finalizeFile(data: FileData) {
        this.transformBuffer(data).then(() => {
            Compress.tryFile(data, 'gz', this.performAsyncTask.bind(this), this.completeAsyncTask.bind(this));
            if (Node.checkVersion(11, 7)) {
                Compress.tryFile(data, 'br', this.performAsyncTask.bind(this), this.completeAsyncTask.bind(this));
            }
            this.completeAsyncTask(data.filepath);
        });
    }
    processAssets() {
        const emptyDir = new Set<string>();
        const notFound: ObjectMap<boolean> = {};
        const processing: ObjectMap<ExpressAsset[]> = {};
        const appending: ObjectMap<ExpressAsset[]> = {};
        const completed: string[] = [];
        const checkQueue = (file: ExpressAsset, filepath: string, content?: boolean) => {
            const bundleIndex = file.bundleIndex;
            if (bundleIndex !== undefined && bundleIndex !== -1) {
                appending[filepath] ||= [];
                if (bundleIndex > 0) {
                    appending[filepath][bundleIndex - 1] = file;
                    return true;
                }
            }
            else if (!content) {
                if (completed.includes(filepath)) {
                    this.writeBuffer({ file, filepath });
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
        const processQueue = async (file: ExpressAsset, filepath: string, bundleMain?: ExpressAsset) => {
            if (file.bundleIndex !== undefined) {
                if (file.bundleIndex === 0) {
                    let content = this.getUTF8String(file, filepath);
                    if (content) {
                        content = await this.appendContent(file, filepath, content, 0);
                        if (content) {
                            file.sourceUTF8 = content;
                        }
                        file.invalid = false;
                        bundleMain = file;
                    }
                    else {
                        content = await this.getTrailingContent(file);
                        if (content) {
                            file.sourceUTF8 = content;
                            file.invalid = false;
                            bundleMain = file;
                        }
                        else {
                            delete file.sourceUTF8;
                            file.bundleIndex = -1;
                            file.invalid = true;
                        }
                    }
                }
                const items = appending[filepath];
                if (items) {
                    let queue: Undef<ExpressAsset>;
                    while (!queue && items.length) {
                        queue = items.shift();
                    }
                    if (queue) {
                        const uri = queue.uri;
                        const verifyBundle = async (value: string) => {
                            if (bundleMain) {
                                return this.appendContent(queue!, filepath, value, queue!.bundleIndex!);
                            }
                            if (value) {
                                queue!.sourceUTF8 = await this.appendContent(queue!, filepath, value, 0) || value;
                                queue!.invalid = false;
                                bundleMain = queue;
                            }
                            else {
                                queue!.invalid = true;
                            }
                            return Promise.resolve();
                        };
                        const resumeQueue = () => processQueue(queue!, filepath, bundleMain);
                        if (queue.content) {
                            verifyBundle(queue.content).then(resumeQueue);
                        }
                        else if (uri) {
                            request(uri, (err, response) => {
                                if (err) {
                                    notFound[uri] = true;
                                    queue!.invalid = true;
                                    this.writeFail(uri, err);
                                    resumeQueue();
                                }
                                else {
                                    const statusCode = response.statusCode;
                                    if (statusCode >= 300) {
                                        notFound[uri] = true;
                                        queue!.invalid = true;
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
                if (bundleMain || !file.invalid) {
                    this.finalizeFile({ file: bundleMain || file, filepath });
                }
                else {
                    this.completeAsyncTask();
                }
                delete appending[filepath];
            }
            else if (Array.isArray(processing[filepath])) {
                completed.push(filepath);
                for (const item of processing[filepath]) {
                    if (!item.invalid) {
                        this.writeBuffer({ file: item, filepath });
                    }
                }
                delete processing[filepath];
            }
            else {
                this.writeBuffer({ file, filepath });
            }
        };
        const errorRequest = (file: ExpressAsset, filepath: string, message: Error | string, stream?: fs.WriteStream) => {
            const uri = file.uri!;
            if (!notFound[uri]) {
                if (appending[filepath]) {
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
            file.invalid = true;
            this.writeFail(uri, message);
            delete processing[filepath];
        };
        for (const file of this.assets) {
            if (file.exclude) {
                file.invalid = true;
                continue;
            }
            const { pathname, filepath } = this.getFileOutput(file);
            const fileReceived = (err: NodeJS.ErrnoException) => {
                if (err) {
                    file.invalid = true;
                }
                if (!err || appending[filepath]) {
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
                        file.invalid = true;
                        this.writeFail(pathname, err);
                    }
                }
                emptyDir.add(pathname);
            }
            if (file.content) {
                if (!checkQueue(file, filepath, true)) {
                    this.performAsyncTask();
                    fs.writeFile(
                        filepath,
                        file.content,
                        'utf8',
                        err => fileReceived(err)
                    );
                }
            }
            else if (file.base64) {
                this.performAsyncTask();
                fs.writeFile(
                    filepath,
                    file.base64,
                    'base64',
                    err => {
                        if (!err) {
                            this.writeBuffer({ file, filepath });
                        }
                        else {
                            file.invalid = true;
                            this.completeAsyncTask();
                        }
                    }
                );
            }
            else {
                const uri = file.uri;
                if (!uri || notFound[uri]) {
                    file.invalid = true;
                    continue;
                }
                try {
                    if (Node.isFileURI(uri)) {
                        if (!checkQueue(file, filepath)) {
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
                                .on('data', data => {
                                    if (typeof data === 'string') {
                                        file.sourceUTF8 = data;
                                    }
                                    else {
                                        file.buffer = data;
                                    }
                                })
                                .on('error', err => errorRequest(file, filepath, err, stream))
                                .pipe(stream);
                            }
                    }
                    else if (Node.canReadUNC() && Node.isFileUNC(uri) || Node.canReadDisk() && path.isAbsolute(uri)) {
                        if (!checkQueue(file, filepath)) {
                            this.performAsyncTask();
                            fs.copyFile(
                                uri,
                                filepath,
                                err => fileReceived(err)
                            );
                        }
                    }
                    else {
                        file.invalid = true;
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
        let tasks: Promise<unknown>[] = [];
        for (const [filepath, content] of this.contentToAppend) {
            let output = '';
            for (const value of content) {
                if (value) {
                    output += '\n' + value;
                }
            }
            const file = this.assets.find(item => item.filepath === filepath && (item.sourceUTF8 || item.buffer));
            if (file) {
                file.sourceUTF8 = this.getUTF8String(file, filepath) + output;
            }
            else if (fs.existsSync(filepath)) {
                tasks.push(fs.appendFile(filepath, output));
            }
            else {
                tasks.push(fs.writeFile(filepath, output));
            }
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => Node.writeFail('Finalize: Append UTF-8', err));
            tasks = [];
        }
        const inlineMap: StringMap = {};
        const base64Map: StringMap = {};
        for (const item of this.assets) {
            if (item.inlineContent && item.inlineContent.startsWith('<!--') && !item.invalid) {
                const setContent = (value: string) => {
                    inlineMap[item.inlineContent!] = value.trim();
                    item.invalid = true;
                };
                if (item.sourceUTF8 || item.buffer) {
                    setContent(this.getUTF8String(item));
                    tasks.push(Promise.resolve());
                }
                else {
                    tasks.push(fs.readFile(item.filepath!, 'utf8').then(data => setContent(data)));
                }
            }
        }
        if (tasks.length) {
            const html = this.getHtmlPages();
            if (html.length) {
                await Promise.all(tasks).then(() => {
                    for (const item of html) {
                        let content = this.getUTF8String(item);
                        if (content) {
                            for (const id in inlineMap) {
                                const value = inlineMap[id]!;
                                content = content.replace(new RegExp((value.includes(' ') ? '[ \t]*' : '') + id), value);
                            }
                            item.sourceUTF8 = content;
                        }
                    }
                })
                .catch(err => Node.writeFail('Finalize: Inline UTF-8', err));
            }
            tasks = [];
        }
        for (const [file, output] of this.filesToCompare) {
            const filepath = file.filepath!;
            let minFile = filepath,
                minSize = this.getFileSize(minFile);
            for (const other of output) {
                const size = this.getFileSize(other);
                if (size > 0 && size < minSize) {
                    this.filesToRemove.add(minFile);
                    minFile = other;
                    minSize = size;
                }
                else {
                    this.filesToRemove.add(other);
                }
            }
            if (minFile !== filepath) {
                this.replace(file, minFile);
            }
        }
        for (const value of this.filesToRemove) {
            try {
                if (fs.existsSync(value)) {
                    fs.unlinkSync(value);
                }
                this.delete(value);
            }
            catch (err) {
                this.writeFail(value, err);
            }
        }
        for (const item of this.assets) {
            if (item.inlineBase64 && !item.invalid) {
                const filepath = item.filepath!;
                const mimeType = mime.lookup(filepath).toString();
                if (mimeType.startsWith('image/')) {
                    tasks.push(
                        fs.readFile(filepath).then((data: Buffer) => {
                            base64Map[item.inlineBase64!] = `data:${mimeType};base64,${data.toString('base64')}`;
                            item.invalid = true;
                        })
                    );
                }
            }
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => Node.writeFail('Finalize: Read base64', err));
            tasks = [];
        }
        const assets = this.assets.filter(item => !item.invalid);
        const replaced = assets.filter(item => item.originalName);
        if (replaced.length || Object.keys(base64Map) || this.productionRelease) {
            const replaceContent = (file: ExpressAsset, value: string) => {
                for (const id in base64Map) {
                    value = value.replace(new RegExp(id, 'g'), base64Map[id]!);
                }
                for (const asset of replaced) {
                    value = value.replace(new RegExp(this.escapePathSeparator(this.getFileUri(asset, asset.originalName)), 'g'), this.getFileUri(asset));
                }
                if (this.productionRelease) {
                    value = value.replace(new RegExp(`(\\.\\./)*${this.serverRoot}`, 'g'), '');
                }
                file.sourceUTF8 = value;
            };
            for (const item of assets) {
                switch (item.mimeType) {
                    case '@text/html':
                    case '@application/xhtml+xml':
                    case '@text/css':
                    case '&text/css':
                        if (item.sourceUTF8 || item.buffer) {
                            replaceContent(item, this.getUTF8String(item));
                        }
                        else {
                            tasks.push(fs.readFile(item.filepath!, 'utf8').then(data => replaceContent(item, data)));
                        }
                        break;
                }
            }
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => Node.writeFail('Finalize: Replace UTF-8', err));
            tasks = [];
        }
        for (const item of assets) {
            if (item.sourceUTF8) {
                tasks.push(fs.writeFile(item.filepath!, item.sourceUTF8, 'utf8'));
            }
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => Node.writeFail('Finalize: Write UTF-8', err));
            tasks = [];
        }
        if (this.Gulp) {
            const taskMap = new Map<string, Map<string, GulpData>>();
            const origMap = new Map<string, string[]>();
            for (const item of assets) {
                if (item.tasks) {
                    const origDir = path.dirname(item.filepath!);
                    const scheduled = new Set<string>();
                    for (let task of item.tasks) {
                        if (!scheduled.has(task = task.trim()) && this.Gulp[task]) {
                            const gulpfile = path.resolve(this.Gulp[task]!);
                            if (fs.existsSync(gulpfile)) {
                                if (!taskMap.has(task)) {
                                    taskMap.set(task, new Map<string, GulpData>());
                                }
                                const dirMap = taskMap.get(task)!;
                                if (!dirMap.has(origDir)) {
                                    dirMap.set(origDir, { gulpfile, items: [] });
                                }
                                dirMap.get(origDir)!.items.push(item.filepath!);
                                scheduled.add(task);
                            }
                        }
                    }
                    if (scheduled.size) {
                        const stored = origMap.get(origDir);
                        const items = Array.from(scheduled);
                        if (!stored) {
                            origMap.set(origDir, items);
                        }
                        else {
                            let previous = -1;
                            for (const task of items.reverse()) {
                                const index = stored.indexOf(task);
                                if (index !== -1) {
                                    if (index > previous) {
                                        stored.splice(index, 1);
                                    }
                                    else {
                                        previous = index;
                                        continue;
                                    }
                                }
                                if (previous !== -1) {
                                    stored.splice(previous--, 0, task);
                                }
                                else {
                                    stored.push(task);
                                    previous = stored.length - 1;
                                }
                            }
                        }
                    }
                }
            }
            const itemsAsync: GulpTask[] = [];
            const itemsSync: GulpTask[] = [];
            for (const [task, dirMap] of taskMap) {
                for (const [origDir, data] of dirMap) {
                    const item = origMap.get(origDir);
                    (item && item.length > 1 ? itemsSync : itemsAsync).push({ task, origDir, data });
                }
            }
            itemsSync.sort((a, b) => {
                if (a.origDir === b.origDir && a.task !== b.task) {
                    const taskData = origMap.get(a.origDir)!;
                    const indexA = taskData.indexOf(a.task);
                    const indexB = taskData.indexOf(b.task);
                    if (indexA !== -1 && indexB !== -1) {
                        if (indexA < indexB) {
                            return -1;
                        }
                        if (indexB < indexA) {
                            return 1;
                        }
                    }
                }
                return 0;
            });
            [itemsAsync, itemsSync].forEach((items, index) => {
                for (const { task, origDir, data } of items) {
                    const tempDir = process.cwd() + path.sep + 'temp' + path.sep + uuid.v4();
                    const processFiles = () => {
                        try {
                            fs.mkdirpSync(tempDir);
                            for (const file of data.items) {
                                fs.copyFileSync(file, path.join(tempDir, path.basename(file)));
                            }
                            child_process.exec(`gulp ${task} --gulpfile "${data.gulpfile}" --cwd "${tempDir}"`, { cwd: process.cwd() });
                            for (const filepath of data.items) {
                                try {
                                    fs.unlinkSync(filepath);
                                    this.delete(filepath);
                                }
                                catch {
                                }
                            }
                            for (const file of fs.readdirSync(tempDir)) {
                                try {
                                    const filepath = path.join(origDir, path.basename(file));
                                    fs.moveSync(path.join(tempDir, file), filepath, { overwrite: true });
                                    this.add(filepath);
                                }
                                catch {
                                }
                            }
                        }
                        catch (err) {
                            Node.writeFail(`Gulp: exec (${task}:${path.basename(data.gulpfile)})`, err);
                        }
                    };
                    if (index === 0) {
                        tasks.push(
                            new Promise(resolve => {
                                processFiles();
                                resolve();
                            })
                        );
                    }
                    else {
                        processFiles();
                    }
                }
            });
        }
        return Promise.all(tasks).catch(err => {
            Node.writeFail('Gulp: Finalize', err);
            return err;
        });
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileManager;
    module.exports.default = FileManager;
    module.exports.__esModule = true;
}

export default FileManager;