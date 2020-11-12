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
type ExternalAsset = functions.ExternalAsset;
type IFileManager = functions.IFileManager;

type FileData = functions.internal.FileData;
type FileOutput = functions.internal.FileOutput;
type CompressFormat = functions.squared.CompressFormat;

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
    public basePath?: string;
    public readonly files = new Set<string>();
    public readonly filesQueued = new Set<string>();
    public readonly filesToRemove = new Set<string>();
    public readonly filesToCompare = new Map<ExternalAsset, string[]>();
    public readonly contentToAppend = new Map<string, string[]>();
    public readonly postFinalize: FunctionType<void>;
    public readonly dataMap: DataMap;
    public readonly baseAsset?: ExternalAsset;

    constructor(
        public readonly dirname: string,
        public readonly assets: ExternalAsset[],
        postFinalize: FunctionType<void>)
    {
        super();
        this.baseAsset = assets.find(item => item.basePath);
        this.basePath = this.baseAsset?.basePath;
        this.dataMap = assets[0].dataMap || {};
        this.postFinalize = postFinalize.bind(this);
        assets.sort((a, b) => {
            if (a === this.baseAsset) {
                return 1;
            }
            if (b === this.baseAsset) {
                return -1;
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
    has(value: string) {
        return this.files.has(value.substring(this.dirname.length + 1));
    }
    replace(file: ExternalAsset, replaceWith: string) {
        const fileUri = file.fileUri;
        if (fileUri) {
            if (replaceWith.includes('__copy__') && path.extname(fileUri) === path.extname(replaceWith)) {
                try {
                    fs.renameSync(replaceWith, fileUri);
                }
                catch (err) {
                    this.writeFail(replaceWith, err);
                }
            }
            else {
                this.filesToRemove.add(fileUri);
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
    completeAsyncTask(fileUri?: string) {
        if (this.delayed !== Infinity) {
            if (fileUri) {
                this.add(fileUri);
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
        return [locationDir.filter(value => value), assetDir];
    }
    findAsset(uri: string, fromElement?: boolean) {
        return this.assets.find(item => item.uri === uri && (fromElement && item.textContent || !fromElement && !item.textContent) && !item.invalid);
    }
    replacePath(source: string, segments: string[], value: string, matchSingle = true, base64?: boolean) {
        let output: Undef<string>;
        for (let segment of segments) {
            segment = !base64 ? this.escapePathSeparator(segment) : `[^"',]+,\\s*` + segment;
            const pattern = new RegExp(`([sS][rR][cC]|[hH][rR][eE][fF]|[dD][aA][tT][aA]|[pP][oO][sS][tT][eE][rR]=)?(["'])?(\\s*)${segment}(\\s*)\\2?`, 'g');
            let match: Null<RegExpExecArray>;
            while (match = pattern.exec(source)) {
                output = (output || source).replace(match[0], match[1] ? match[1].toLowerCase() + `"${value}"` : (match[2] || '') + match[3] + value + match[4] + (match[2] || ''));
                if (matchSingle && output !== source) {
                    break;
                }
            }
        }
        return output;
    }
    escapePathSeparator(value: string) {
        return value.replace(/[\\/]/g, '[\\\\/]');
    }
    getFileOutput(file: ExternalAsset): FileOutput {
        const pathname = path.join(this.dirname, file.moveTo || '', file.pathname);
        const fileUri = path.join(pathname, file.filename);
        file.fileUri = fileUri;
        return { pathname, fileUri };
    }
    getRelativeUri(file: ExternalAsset, uri: string) {
        let asset = this.findAsset(uri),
            origin = file.uri;
        if (!asset && origin) {
            const location = Node.resolvePath(uri, origin);
            if (location) {
                asset = this.findAsset(location);
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
    getFileUri(file: ExternalAsset, filename = file.filename) {
        return Node.toPosixPath(path.join(file.moveTo || '', file.pathname, filename));
    }
    getUTF8String(file: ExternalAsset, fileUri?: string) {
        return file.sourceUTF8 ||= file.buffer?.toString('utf8') || fs.readFileSync(fileUri || file.fileUri!, 'utf8');
    }
    async appendContent(file: ExternalAsset, fileUri: string, content: string, bundleIndex: number) {
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
        const items = this.contentToAppend.get(fileUri) || [];
        items[bundleIndex - 1] = content;
        this.contentToAppend.set(fileUri, items);
        return Promise.resolve('');
    }
    async getTrailingContent(file: ExternalAsset) {
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
    transformCss(file: ExternalAsset, source: string) {
        let output: Undef<string>;
        for (const item of this.assets) {
            if (item.base64 && !item.textContent && item.uri && !item.invalid) {
                const url = this.getRelativeUri(file, item.uri);
                if (url) {
                    const replaced = this.replacePath(output || source, [item.base64.replace(/\+/g, '\\+')], url, false, true);
                    if (replaced) {
                        output = replaced;
                    }
                }
            }
        }
        if (output) {
            source = output;
        }
        const baseUri = file.uri!;
        const pattern = /url\(\s*([^)]+)\s*\)/ig;
        let match: Null<RegExpExecArray>;
        while (match = pattern.exec(source)) {
            const url = match[1].replace(/^["']\s*/, '').replace(/\s*["']$/, '');
            if (!Node.isFileURI(url) || Node.fromSameOrigin(baseUri, url)) {
                let location = this.getRelativeUri(file, url);
                if (location) {
                    output = (output || source).replace(match[0], `url(${location})`);
                }
                else if (this.baseAsset) {
                    location = Node.resolvePath(url, this.baseAsset.uri!);
                    if (location) {
                        const asset = this.findAsset(location);
                        if (asset) {
                            location = this.getRelativeUri(file, location);
                            if (location) {
                                output = (output || source).replace(match[0], `url(${location})`);
                            }
                        }
                    }
                }
            }
            else {
                const asset = this.findAsset(url);
                if (asset) {
                    const count = file.pathname !== '/' && !file.basePath ? file.pathname.split(/[\\/]/).length : 0;
                    output = (output || source).replace(match[0], `url(${(count ? '../'.repeat(count) : '') + this.getFileUri(asset)})`);
                }
            }
        }
        return output;
    }
    async transformBuffer(data: FileData) {
        const { file, fileUri } = data;
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
                let html = this.getUTF8String(file, fileUri),
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
                                if (item.fileUri) {
                                    this.filesToRemove.add(item.fileUri);
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
                                if (replacing !== source) {
                                    item.textContent = output;
                                }
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
                const basePath = this.basePath;
                for (const item of this.assets) {
                    if (item === file || item.content || item.bundleIndex !== undefined || item.inlineContent || !item.uri || item.invalid) {
                        continue;
                    }
                    const { uri, textContent } = item;
                    if (textContent) {
                        item.mimeType ||= mime.lookup(uri).toString();
                        const segments = [uri];
                        let value: string,
                            relativeUri: Undef<string>,
                            ascending: Undef<boolean>;
                        if (basePath) {
                            relativeUri = uri.replace(basePath, '');
                            if (relativeUri === uri) {
                                relativeUri = '';
                            }
                        }
                        if (!relativeUri && Node.fromSameOrigin(baseUri, uri)) {
                            relativeUri = path.join(item.pathname, path.basename(uri));
                            ascending = true;
                        }
                        if (relativeUri) {
                            segments.push(relativeUri);
                        }
                        if (item.mimeType.startsWith('image/') && item.format === 'base64') {
                            value = uuid.v4();
                            item.inlineBase64 = value;
                        }
                        else {
                            value = this.getFileUri(item);
                        }
                        const innerContent = textContent.replace(/^\s*<\s*/, '').replace(/\s*\/?\s*>([\S\s]*<\/\w+>)?\s*$/, '');
                        const replaced = this.replacePath(innerContent, segments, value);
                        if (replaced) {
                            const result = source.replace(innerContent, replaced);
                            if (result !== source) {
                                source = result;
                                html = result;
                                continue;
                            }
                        }
                        if (relativeUri) {
                            pattern = new RegExp(`(["'\\s,=])(` + (ascending ? '(?:(?:\\.\\.)?(?:[\\\\/]\\.\\.|\\.\\.[\\\\/]|[\\\\/])*)?' : '') + this.escapePathSeparator(relativeUri) + ')', 'g');
                            while (match = pattern.exec(html)) {
                                if (uri === Node.resolvePath(match[2], baseUri)) {
                                    source = source.replace(match[0], match[1] + value);
                                    break;
                                }
                            }
                        }
                    }
                    else if (item.base64) {
                        const replaced = this.replacePath(source, [item.base64.replace(/\+/g, '\\+')], this.getFileUri(item), false, true);
                        if (replaced) {
                            source = replaced;
                        }
                    }
                    html = source;
                }
                source = (this.transformCss(file, source) || source)
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
                    const result = await Chrome.minifyHtml(format, this.getUTF8String(file, fileUri), this.dataMap.transpileMap);
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
                        file.sourceUTF8 = this.getUTF8String(file, fileUri) + trailing;
                    }
                    break;
                }
                const content = this.getUTF8String(file, fileUri);
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
                        file.sourceUTF8 = this.getUTF8String(file, fileUri) + trailing;
                    }
                    break;
                }
                const content = this.getUTF8String(file, fileUri);
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
                    if (compress && !Compress.withinSizeRange(fileUri, compress.condition)) {
                        compress = undefined;
                    }
                    const callback = this.finalizeImage.bind(this);
                    if (mimeType === 'image/unknown') {
                        Image.using.call(this, { data, compress, callback });
                    }
                    else if (file.commands) {
                        for (const command of file.commands) {
                            if (Compress.withinSizeRange(fileUri, command)) {
                                Image.using.call(this, { data, compress, command, callback });
                            }
                        }
                    }
                }
                break;
        }
        return Promise.resolve();
    }
    newImage(data: FileData, outputType: string, saveAs: string, command = '') {
        const fileUri = data.fileUri;
        let output: Undef<string>;
        if (data.file.mimeType === outputType) {
            if (!command.includes('@') || this.filesQueued.has(fileUri)) {
                let i = 1;
                do {
                    output = this.replaceExtension(fileUri, '__copy__.' + (i > 1 ? `(${i}).` : '') + saveAs);
                }
                while (this.filesQueued.has(output) && ++i);
                try {
                    fs.copyFileSync(fileUri, output);
                }
                catch (err) {
                    this.writeFail(fileUri, err);
                    return '';
                }
            }
        }
        else {
            let i = 1;
            do {
                output = this.replaceExtension(fileUri, (i > 1 ? `(${i}).` : '') + saveAs);
            }
            while (this.filesQueued.has(output) && ++i);
        }
        output ||= fileUri;
        this.filesQueued.add(output);
        return output;
    }
    replaceImage(data: FileData, output: string, command: string) {
        const { file, fileUri } = data;
        if (fileUri !== output) {
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
        const png = Compress.hasImageService() ? Compress.findFormat(data.file.compress, 'png') : undefined;
        if (png && Compress.withinSizeRange(data.fileUri, png.condition)) {
            try {
                Compress.tryImage(data.fileUri, (result: string, err: Null<Error>) => {
                    if (err) {
                        throw err;
                    }
                    if (result) {
                        data.fileUri = result;
                    }
                    this.finalizeFile(data);
                });
            }
            catch (err) {
                this.writeFail(data.fileUri, err);
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
            this.completeAsyncTask(data.fileUri);
        });
    }
    processAssets() {
        const emptyDir = new Set<string>();
        const notFound: ObjectMap<boolean> = {};
        const processing: ObjectMap<ExternalAsset[]> = {};
        const appending: ObjectMap<ExternalAsset[]> = {};
        const completed: string[] = [];
        const checkQueue = (file: ExternalAsset, fileUri: string, content?: boolean) => {
            const bundleIndex = file.bundleIndex;
            if (bundleIndex !== undefined && bundleIndex !== -1) {
                appending[fileUri] ||= [];
                if (bundleIndex > 0) {
                    appending[fileUri][bundleIndex - 1] = file;
                    return true;
                }
            }
            else if (!content) {
                if (completed.includes(fileUri)) {
                    this.writeBuffer({ file, fileUri });
                    return true;
                }
                else {
                    const queue = processing[fileUri];
                    if (queue) {
                        this.performAsyncTask();
                        queue.push(file);
                        return true;
                    }
                    else {
                        processing[fileUri] = [file];
                    }
                }
            }
            return false;
        };
        const processQueue = async (file: ExternalAsset, fileUri: string, bundleMain?: ExternalAsset) => {
            if (file.bundleIndex !== undefined) {
                if (file.bundleIndex === 0) {
                    let content = this.getUTF8String(file, fileUri);
                    if (content) {
                        content = await this.appendContent(file, fileUri, content, 0);
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
                const items = appending[fileUri];
                if (items) {
                    let queue: Undef<ExternalAsset>;
                    while (!queue && items.length) {
                        queue = items.shift();
                    }
                    if (queue) {
                        const uri = queue.uri;
                        const verifyBundle = async (value: string) => {
                            if (bundleMain) {
                                return this.appendContent(queue!, fileUri, value, queue!.bundleIndex!);
                            }
                            if (value) {
                                queue!.sourceUTF8 = await this.appendContent(queue!, fileUri, value, 0) || value;
                                queue!.invalid = false;
                                bundleMain = queue;
                            }
                            else {
                                queue!.invalid = true;
                            }
                            return Promise.resolve();
                        };
                        const resumeQueue = () => processQueue(queue!, fileUri, bundleMain);
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
                    this.finalizeFile({ file: bundleMain || file, fileUri });
                }
                else {
                    this.completeAsyncTask();
                }
                delete appending[fileUri];
            }
            else if (Array.isArray(processing[fileUri])) {
                completed.push(fileUri);
                for (const item of processing[fileUri]) {
                    if (!item.invalid) {
                        this.writeBuffer({ file: item, fileUri });
                    }
                }
                delete processing[fileUri];
            }
            else {
                this.writeBuffer({ file, fileUri });
            }
        };
        const errorRequest = (file: ExternalAsset, fileUri: string, message: Error | string, stream?: fs.WriteStream) => {
            const uri = file.uri!;
            if (!notFound[uri]) {
                if (appending[fileUri]) {
                    processQueue(file, fileUri);
                }
                else {
                    this.completeAsyncTask();
                }
                notFound[uri] = true;
            }
            if (stream) {
                try {
                    stream.close();
                    fs.unlink(fileUri);
                }
                catch {
                }
            }
            file.invalid = true;
            this.writeFail(uri, message);
            delete processing[fileUri];
        };
        for (const file of this.assets) {
            if (file.exclude) {
                file.invalid = true;
                continue;
            }
            const { pathname, fileUri } = this.getFileOutput(file);
            const fileReceived = (err: NodeJS.ErrnoException) => {
                if (err) {
                    file.invalid = true;
                }
                if (!err || appending[fileUri]) {
                    processQueue(file, fileUri);
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
                try {
                    fs.mkdirpSync(pathname);
                }
                catch (err) {
                    file.invalid = true;
                    this.writeFail(pathname, err);
                }
                emptyDir.add(pathname);
            }
            if (file.content) {
                if (!checkQueue(file, fileUri, true)) {
                    file.sourceUTF8 = file.content;
                    this.performAsyncTask();
                    fs.writeFile(
                        fileUri,
                        file.content,
                        'utf8',
                        err => fileReceived(err)
                    );
                }
            }
            else if (file.base64) {
                this.performAsyncTask();
                fs.writeFile(
                    fileUri,
                    file.base64,
                    'base64',
                    err => {
                        if (!err) {
                            this.writeBuffer({ file, fileUri });
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
                        if (!checkQueue(file, fileUri)) {
                            const stream = fs.createWriteStream(fileUri);
                            stream.on('finish', () => {
                                if (!notFound[uri]) {
                                    processQueue(file, fileUri);
                                }
                            });
                            this.performAsyncTask();
                            request(uri)
                                .on('response', response => {
                                    const statusCode = response.statusCode;
                                    if (statusCode >= 300) {
                                        errorRequest(file, fileUri, statusCode + ' ' + response.statusMessage, stream);
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
                                .on('error', err => errorRequest(file, fileUri, err, stream))
                                .pipe(stream);
                            }
                    }
                    else if (Node.canReadUNC() && Node.isFileUNC(uri) || Node.canReadDisk() && path.isAbsolute(uri)) {
                        if (!checkQueue(file, fileUri)) {
                            this.performAsyncTask();
                            fs.copyFile(
                                uri,
                                fileUri,
                                err => fileReceived(err)
                            );
                        }
                    }
                    else {
                        file.invalid = true;
                    }
                }
                catch (err) {
                    errorRequest(file, fileUri, err);
                }
            }
        }
        this.cleared = true;
        this.performFinalize();
    }
    async finalizeAssets() {
        let tasks: Promise<unknown>[] = [];
        for (const [fileUri, content] of this.contentToAppend) {
            let output = '';
            for (const value of content) {
                if (value) {
                    output += '\n' + value;
                }
            }
            const file = this.assets.find(item => item.fileUri === fileUri && (item.sourceUTF8 || item.buffer));
            if (file) {
                file.sourceUTF8 = this.getUTF8String(file, fileUri) + output;
            }
            else if (this.has(fileUri)) {
                tasks.push(fs.appendFile(fileUri, output));
            }
            else {
                tasks.push(fs.writeFile(fileUri, output));
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
                    tasks.push(fs.readFile(item.fileUri!, 'utf8').then(data => setContent(data)));
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
            const fileUri = file.fileUri!;
            let minFile = fileUri,
                minSize = this.getFileSize(minFile);
            for (const other of output) {
                const size = this.getFileSize(other);
                if (minSize === 0 || size > 0 && size < minSize) {
                    this.filesToRemove.add(minFile);
                    minFile = other;
                    minSize = size;
                }
                else {
                    this.filesToRemove.add(other);
                }
            }
            if (minFile !== fileUri) {
                this.replace(file, minFile);
            }
        }
        for (const item of this.assets) {
            if (item.inlineBase64 && !item.invalid) {
                const fileUri = item.fileUri!;
                const mimeType = mime.lookup(fileUri).toString();
                if (mimeType.startsWith('image/')) {
                    tasks.push(
                        fs.readFile(fileUri).then((data: Buffer) => {
                            base64Map[item.inlineBase64!] = `data:${mimeType};base64,${data.toString('base64')}`;
                            item.invalid = true;
                        })
                    );
                }
            }
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => Node.writeFail('Finalize: Cache base64', err));
            tasks = [];
        }
        const assets = this.assets.filter(item => !item.invalid);
        const replaced = assets.filter(item => item.originalName);
        if (replaced.length || Object.keys(base64Map) || this.productionRelease) {
            const replaceContent = (file: ExternalAsset, value: string) => {
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
                            tasks.push(fs.readFile(item.fileUri!, 'utf8').then(data => replaceContent(item, data)));
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
                tasks.push(fs.writeFile(item.fileUri!, item.sourceUTF8, 'utf8'));
            }
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => Node.writeFail('Finalize: Write UTF-8', err));
            tasks = [];
        }
        for (const item of assets) {
            const fileUri = item.fileUri!;
            if (this.has(fileUri)) {
                const gz = Compress.findFormat(item.compress, 'gz');
                if (gz) {
                    tasks.push(
                        new Promise(resolve => Compress.tryFile(fileUri, gz, undefined, (result: string) => {
                            if (result) {
                                this.add(result);
                            }
                            resolve();
                        }))
                    );
                }
                if (Node.checkVersion(11, 7)) {
                    const br = Compress.findFormat(item.compress, 'br');
                    if (br) {
                        tasks.push(
                            new Promise(resolve => Compress.tryFile(fileUri, br, undefined, (result: string) => {
                                if (result) {
                                    this.add(result);
                                }
                                resolve();
                            }))
                        );
                    }
                }
            }
        }
        for (const value of this.filesToRemove) {
            tasks.push(fs.unlink(value).then(() => this.delete(value)));
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => Node.writeFail('Finalize: Compress and delete temp files', err));
            tasks = [];
        }
        if (this.Gulp) {
            const taskMap = new Map<string, Map<string, GulpData>>();
            const origMap = new Map<string, string[]>();
            for (const item of assets) {
                if (item.tasks) {
                    const origDir = path.dirname(item.fileUri!);
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
                                dirMap.get(origDir)!.items.push(item.fileUri!);
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
            const resumeThread = (item: GulpTask, callback: () => void) => {
                const { task, origDir, data } = item;
                const tempDir = this.getTempDir() + uuid.v4();
                try {
                    fs.mkdirpSync(tempDir);
                    Promise.all(data.items.map(fileUri => fs.copyFile(fileUri, path.join(tempDir, path.basename(fileUri)))))
                        .then(() => {
                            child_process.exec(`gulp ${task} --gulpfile "${data.gulpfile}" --cwd "${tempDir}"`, { cwd: process.cwd() }, err => {
                                if (!err) {
                                    Promise.all(data.items.map(fileUri => fs.unlink(fileUri).then(() => this.delete(fileUri))))
                                        .then(() => {
                                            fs.readdir(tempDir, (errRead, files) => {
                                                if (errRead) {
                                                    callback();
                                                }
                                                else {
                                                    Promise.all(
                                                        files.map(filename => {
                                                            const origUri = path.join(origDir, filename);
                                                            return fs.move(path.join(tempDir, filename), origUri, { overwrite: true }).then(() => this.add(origUri));
                                                        }))
                                                        .then(() => callback())
                                                        .catch(errWrite => {
                                                            Node.writeFail('Gulp: Unable to replace original files', errWrite);
                                                            callback();
                                                        });
                                                }
                                            });
                                        })
                                        .catch(error => Node.writeFail('Gulp: Unable to delete original files', error));
                                }
                                else {
                                    Node.writeFail(`Gulp: exec (${task}:${path.basename(data.gulpfile)})`, err);
                                    callback();
                                }
                            });
                        })
                        .catch(err => Node.writeFail('Gulp: Unable to copy original files', err));
                }
                catch (err) {
                    Node.writeFail('Gulp: Copy temp files', err);
                    callback();
                }
            };
            for (const item of itemsAsync) {
                tasks.push(new Promise(resolve => resumeThread(item, resolve)));
            }
            if (itemsSync.length) {
                tasks.push(new Promise(resolve => {
                    (function nextTask(this: IFileManager) {
                        const item = itemsSync.shift();
                        if (item) {
                            resumeThread.call(this, item, nextTask);
                        }
                        else {
                            resolve();
                        }
                    }).bind(this)();
                }));
            }
        }
        return Promise.all(tasks).catch(err => {
            Node.writeFail('Finalize: Exec tasks', err);
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