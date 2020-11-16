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
import Cloud from '../cloud';

type Settings = functions.Settings;
type IFileManager = functions.IFileManager;
type IChrome = functions.IChrome;
type ICloud = functions.ICloud;
type RequestBody = functions.RequestBody;
type ExternalAsset = functions.ExternalAsset;

type CompressModule = functions.settings.CompressModule;
type CloudModule = functions.settings.CloudModule;
type GulpModule = functions.settings.GulpModule;
type ChromeModule = functions.settings.ChromeModule;

type FileResponseData = functions.squared.FileResponseData;
type CompressFormat = functions.squared.CompressFormat;
type CloudService = functions.squared.CloudService;

type FileData = functions.internal.FileData;
type FileOutput = functions.internal.FileOutput;
type SourceMapOutput = functions.internal.Chrome.SourceMapOutput;
type CloudServiceHost = functions.external.CloudServiceHost;
type CloudServiceUpload = functions.external.CloudServiceUpload;

interface GulpData {
    gulpfile: string;
    items: string[];
}

interface GulpTask {
    task: string;
    origDir: string;
    data: GulpData;
}

const cloudUploadHostMap: ObjectMap<CloudServiceHost> = {};

const FileManager = class extends Module implements IFileManager {
    public static loadSettings(value: Settings, ignorePermissions?: boolean) {
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
        if (value.compress) {
            const { gzip_level, brotli_quality, tinypng_api_key } = value.compress;
            const gzip = +(gzip_level as string);
            const brotli = +(brotli_quality as string);
            if (!isNaN(gzip)) {
                Compress.gzipLevel = gzip;
            }
            if (!isNaN(brotli)) {
                Compress.brotliQuality = brotli;
            }
            Compress.validate(tinypng_api_key);
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

    public static moduleCloud() {
        return Cloud;
    }

    public static checkPermissions(dirname: string, res?: Response) {
        if (Node.isDirectoryUNC(dirname)) {
            if (!Node.canWriteUNC()) {
                if (res) {
                    res.json({ success: false, error: { hint: 'OPTION: --unc-write', message: 'Writing to UNC shares is not enabled.' } } as FileResponseData);
                }
                return false;
            }
        }
        else if (!Node.canWriteDisk()) {
            if (res) {
                res.json({ success: false, error: { hint: 'OPTION: --disk-write', message: 'Writing to disk is not enabled.' } } as FileResponseData);
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
        catch (err) {
            if (res) {
                res.json({ success: false, error: { hint: `DIRECTORY: ${dirname}`, message: err.toString() } } as FileResponseData);
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
    public Compress?: CompressModule;
    public Chrome?: IChrome;
    public Cloud?: ICloud;
    public Gulp?: GulpModule;
    public basePath?: string;
    public baseAsset?: ExternalAsset;
    public readonly assets: ExternalAsset[];
    public readonly files = new Set<string>();
    public readonly filesQueued = new Set<string>();
    public readonly filesToRemove = new Set<string>();
    public readonly filesToCompare = new Map<ExternalAsset, string[]>();
    public readonly contentToAppend = new Map<string, string[]>();
    public readonly postFinalize: FunctionType<void>;

    private _body: RequestBody;

    constructor(
        public readonly dirname: string,
        body: RequestBody,
        postFinalize: FunctionType<void>)
    {
        super();
        this.assets = body.assets;
        this.postFinalize = postFinalize.bind(this);
        this._body = body;
    }

    install(name: string, ...args: unknown[]) {
        if (typeof args[0] === 'object') {
            switch (name) {
                case 'compress':
                    this.Compress = args[0] as CompressModule;
                    break;
                case 'cloud':
                    Cloud.settings = args[0] as CloudModule;
                    this.Cloud = Cloud;
                    break;
                case 'gulp':
                    this.Gulp = args[0] as GulpModule;
                    break;
                case 'chrome': {
                    const baseAsset = this.assets.find(item => item.basePath);
                    if (baseAsset) {
                        this.baseAsset = baseAsset;
                        this.basePath = baseAsset.basePath;
                        this.assets.sort((a, b) => {
                            if (a === baseAsset) {
                                return 1;
                            }
                            if (b === baseAsset) {
                                return -1;
                            }
                            return 0;
                        });
                    }
                    this.Chrome = new Chrome(args[0] as ChromeModule, this._body);
                    break;
                }
            }
        }
    }
    add(value: string, parent?: ExternalAsset) {
        this.files.add(value.substring(this.dirname.length + 1));
        if (parent) {
            (parent.transforms ||= []).push(value);
        }
    }
    delete(value: string) {
        this.files.delete(value.substring(this.dirname.length + 1));
    }
    has(value: Undef<string>) {
        return value ? this.files.has(value.substring(this.dirname.length + 1)) : false;
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
                file.originalName ||= file.filename;
                file.filename = path.basename(replaceWith);
                file.fileUri = this.getFileOutput(file).fileUri;
                file.mimeType = mime.lookup(replaceWith) || file.mimeType;
                this.filesToRemove.add(fileUri);
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
    completeAsyncTask(fileUri?: string, parent?: ExternalAsset) {
        if (this.delayed !== Infinity) {
            if (fileUri) {
                this.add(fileUri, parent);
            }
            this.removeAsyncTask();
            this.performFinalize();
        }
    }
    performFinalize() {
        if (this.cleared && this.delayed <= 0) {
            this.delayed = Infinity;
            this.finalize().then(() => this.postFinalize());
        }
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
    getHtmlPages() {
        return this.assets.filter(item => item.mimeType === '@text/html');
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
        const origin = file.uri!;
        let asset = this.findAsset(uri);
        if (!asset) {
            const location = Node.resolvePath(uri, origin);
            if (location) {
                asset = this.findAsset(location);
            }
        }
        if (asset) {
            const { baseAsset, serverRoot } = this;
            const baseDir = (file.rootDir || '') + file.pathname;
            if (Node.fromSameOrigin(origin, asset.uri!)) {
                const rootDir = asset.rootDir;
                if (asset.moveTo === serverRoot) {
                    if (file.moveTo === serverRoot) {
                        return Node.toPosixPath(path.join(asset.pathname, asset.filename));
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
                    const [originDir, uriDir] = this.getRootDirectory(Node.parsePath(origin)!, Node.parsePath(asset.uri!)!);
                    return '../'.repeat(originDir.length - 1) + uriDir.join('/');
                }
            }
            if (baseAsset && Node.fromSameOrigin(origin, baseAsset.uri!)) {
                const [originDir] = this.getRootDirectory(baseDir + '/' + file.filename, Node.parsePath(baseAsset.uri!)!);
                return '../'.repeat(originDir.length - 1) + this.getFileUri(asset);
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
        const mimeType = file.mimeType;
        if (mimeType) {
            if (mimeType.endsWith('text/css')) {
                const unusedStyles = this.Chrome?.unusedStyles;
                if (!file.preserve && unusedStyles) {
                    const result = this.removeCss(content, unusedStyles);
                    if (result) {
                        content = result;
                    }
                }
                if (mimeType[0] === '@') {
                    const result = this.transformCss(file, content);
                    if (result) {
                        content = result;
                    }
                }
            }
        }
        const trailing = await this.getTrailingContent(file);
        if (trailing) {
            content += trailing;
        }
        if (bundleIndex === 0) {
            return content;
        }
        const items = this.contentToAppend.get(fileUri) || [];
        items[bundleIndex - 1] = content;
        this.contentToAppend.set(fileUri, items);
        return '';
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
                        const unusedStyles = this.Chrome?.unusedStyles;
                        if (!item.preserve && unusedStyles) {
                            const result = this.removeCss(value, unusedStyles);
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
                }
                output += '\n' + value;
            }
        }
        return output;
    }
    transformCss(file: ExternalAsset, source: string) {
        const getCloudUUID = (item: Undef<ExternalAsset>, url: string) => item && Cloud.getService(item.cloudStorage) ? item.inlineCssCloud ||= uuid.v4() : url;
        let output: Undef<string>;
        for (const item of this.assets) {
            if (item.base64 && item.uri && !item.textContent && !item.invalid) {
                const url = this.getRelativeUri(file, item.uri);
                if (url) {
                    const replaced = this.replacePath(output || source, [item.base64.replace(/\+/g, '\\+')], getCloudUUID(item, url), false, true);
                    if (replaced) {
                        output = replaced;
                    }
                    else {
                        delete item.inlineCloud;
                    }
                }
            }
        }
        if (output) {
            source = output;
        }
        const fileUri = file.uri!;
        const baseUri = this.baseAsset?.uri;
        const pattern = /url\(\s*([^)]+)\s*\)/ig;
        let match: Null<RegExpExecArray>;
        while (match = pattern.exec(source)) {
            const url = match[1].replace(/^["']\s*/, '').replace(/\s*["']$/, '');
            if (!Node.isFileURI(url) || Node.fromSameOrigin(fileUri, url)) {
                let location = this.getRelativeUri(file, url);
                if (location) {
                    const uri = Node.resolvePath(url, fileUri);
                    output = (output || source).replace(match[0], `url(${getCloudUUID(uri ? this.findAsset(uri) : undefined, location)})`);
                }
                else if (baseUri) {
                    location = Node.resolvePath(url, baseUri);
                    if (location) {
                        const asset = this.findAsset(location);
                        if (asset) {
                            location = this.getRelativeUri(file, location);
                            if (location) {
                                output = (output || source).replace(match[0], `url(${getCloudUUID(asset, location)})`);
                            }
                        }
                    }
                }
            }
            else {
                const asset = this.findAsset(url);
                if (asset) {
                    const pathname = file.pathname;
                    const count = pathname && pathname !== '/' && !file.basePath ? pathname.split(/[\\/]/).length : 0;
                    output = (output || source).replace(match[0], `url(${getCloudUUID(asset, (count ? '../'.repeat(count) : '') + this.getFileUri(asset))})`);
                }
            }
        }
        return output;
    }
    removeCss(source: string, styles: string[]) {
        let output: Undef<string>,
            pattern: Undef<RegExp>,
            match: Null<RegExpExecArray>;
        for (let value of styles) {
            value = value.replace(/\./g, '\\.');
            pattern = new RegExp(`^\\s*${value}\\s*\\{[^}]*\\}\\n*`, 'gm');
            while (match = pattern.exec(source)) {
                output = (output || source).replace(match[0], '');
            }
            if (output) {
                source = output;
            }
            pattern = new RegExp(`^[^,]*(,?\\s*${value}\\s*[,{](\\s*)).*?\\{?`, 'gm');
            while (match = pattern.exec(source)) {
                const segment = match[1];
                let replaceWith = '';
                if (segment.trim().endsWith('{')) {
                    replaceWith = ' {' + match[2];
                }
                else if (segment[0] === ',') {
                    replaceWith = ', ';
                }
                output = (output || source).replace(match[0], match[0].replace(segment, replaceWith));
            }
            if (output) {
                source = output;
            }
        }
        return output;
    }
    getBundleContent(fileUri: string) {
        const files = this.contentToAppend.get(fileUri);
        if (files) {
            let output = '';
            for (const value of files) {
                if (value) {
                    output += '\n' + value;
                }
            }
            return output;
        }
    }
    async writeSourceMaps(fileUri: string, sourceMap: Map<string, SourceMapOutput>, parent?: ExternalAsset) {
        const tasks: Promise<unknown>[] = [];
        const pathname = path.dirname(fileUri);
        const filename = path.basename(fileUri);
        const ext = path.extname(fileUri);
        const items = Array.from(sourceMap);
        for (let i = 0, length = items.length; i < length; ++i) {
            const [name, data] = items[i];
            const map = data.map;
            let mapName: string;
            if (i < length - 1) {
                mapName = data.url || this.replaceExtension(filename, name + ext + '.map');
                const sourceUri = path.join(pathname, mapName.replace(/\.map$/, ''));
                map.file = path.basename(filename);
                tasks.push(fs.writeFile(sourceUri, data.value, 'utf8').then(() => this.add(sourceUri, parent)).catch(() => true));
            }
            else {
                mapName = data.url || filename + '.map';
                map.file = filename;
            }
            map.sources = [];
            if (data.sourcesContent !== null && (!Array.isArray(map.sourcesContent) || map.sourcesContent.length === 1 && !map.sourcesContent[0])) {
                map.sourcesContent = [data.sourcesContent];
            }
            const mapUri = path.join(pathname, mapName);
            tasks.push(fs.writeFile(mapUri, JSON.stringify(map), 'utf8').then(() => this.add(mapUri, parent)).catch(err => this.writeFail(`Unable to generate source map [${name}]`, err)));
        }
        return Promise.all(tasks);
    }
    async transformBuffer(data: FileData) {
        const chrome = this.Chrome;
        const { file, fileUri } = data;
        const { format, mimeType } = file;
        switch (mimeType) {
            case '@text/html': {
                const minifySpace = (value: string) => value.replace(/(\s+|\/)/g, '');
                const getOuterHTML = (css: boolean, value: string) => css ? `<link rel="stylesheet" href="${value}" />` : `<script src="${value}"></script>`;
                const baseUri = file.uri!;
                const saved = new Set<string>();
                let html = this.getUTF8String(file, fileUri),
                    source = html,
                    pattern = /(\s*)<(script|link|style)[^>]*?(\s+data-chrome-file="\s*(save|export)As:\s*((?:[^"]|\\")+)")[^>]*>(?:[\s\S]*?<\/\2>\n*)?/ig,
                    match: Null<RegExpExecArray>;
                while (match = pattern.exec(html)) {
                    const items = match[5].split('::').map(item => item.trim());
                    if (items[0] === '~') {
                        continue;
                    }
                    const location = this.getAbsoluteUri(items[0], baseUri);
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
                            let value: string;
                            if (Cloud.getService(item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            else {
                                value = this.getFileUri(item);
                            }
                            output = getOuterHTML(/^\s*<link\b/i.test(textContent) || !!item.mimeType?.endsWith('/css'), value);
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
                                else {
                                    delete item.inlineCloud;
                                }
                            }
                            else {
                                delete item.inlineCloud;
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
                    found: {
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
                            if (Cloud.getService(item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            else if (item.mimeType.startsWith('image/') && item.format === 'base64') {
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
                                    html = source;
                                    break found;
                                }
                            }
                            if (relativeUri) {
                                pattern = new RegExp(`(["'\\s,=])(` + (ascending ? '(?:(?:\\.\\.)?(?:[\\\\/]\\.\\.|\\.\\.[\\\\/]|[\\\\/])*)?' : '') + this.escapePathSeparator(relativeUri) + ')', 'g');
                                while (match = pattern.exec(html)) {
                                    if (uri === Node.resolvePath(match[2], baseUri)) {
                                        const result = source.replace(match[0], match[1] + value);
                                        if (result !== source) {
                                            source = result;
                                            html = source;
                                            break found;
                                        }
                                    }
                                }
                            }
                            delete item.inlineCloud;
                            delete item.inlineBase64;
                        }
                        else if (item.base64) {
                            let value: string;
                            if (Cloud.getService(item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            else {
                                value = this.getFileUri(item);
                            }
                            const result = this.replacePath(source, [item.base64.replace(/\+/g, '\\+')], value, false, true);
                            if (result) {
                                source = result;
                                html = source;
                            }
                            else {
                                delete item.inlineCloud;
                            }
                        }
                    }
                }
                source = (this.transformCss(file, source) || source)
                    .replace(/\s*<(script|link|style)[^>]+?data-chrome-file="exclude"[^>]*>[\s\S]*?<\/\1>\n*/ig, '')
                    .replace(/\s*<script[^>]*?data-chrome-template="([^"]|\\")+?"[^>]*>[\s\S]*?<\/script>\n*/ig, '')
                    .replace(/\s*<(script|link)[^>]+?data-chrome-file="exclude"[^>]*>\n*/ig, '')
                    .replace(/\s+data-(?:use|chrome-[\w-]+)="([^"]|\\")+?"/g, '');
                if (format && chrome) {
                    const result = await chrome.transform('html', format, source, chrome.createTransformer(file, fileUri, source));
                    if (result) {
                        file.sourceUTF8 = result[0];
                        break;
                    }
                }
                file.sourceUTF8 = source;
                break;
            }
            case 'text/html':
                if (format && chrome) {
                    const source = this.getUTF8String(file, fileUri);
                    const result = await chrome.transform('html', format, source, chrome.createTransformer(file, fileUri, source));
                    if (result) {
                        file.sourceUTF8 = result[0];
                    }
                }
                break;
            case 'text/css':
            case '@text/css': {
                const unusedStyles = file.preserve !== true && this.Chrome?.unusedStyles;
                const transform = mimeType[0] === '@';
                const trailing = await this.getTrailingContent(file);
                const bundle = this.getBundleContent(fileUri);
                if (unusedStyles && !transform && !trailing && !bundle && (!format || !chrome)) {
                    break;
                }
                let source = this.getUTF8String(file, fileUri);
                if (unusedStyles) {
                    const result = this.removeCss(source, unusedStyles);
                    if (result) {
                        source = result;
                    }
                }
                if (transform) {
                    const result = this.transformCss(file, source);
                    if (result) {
                        source = result;
                    }
                }
                if (trailing) {
                    source += trailing;
                }
                if (bundle) {
                    source += bundle;
                }
                if (format && chrome) {
                    const result = await chrome.transform('css', format, source, chrome.createTransformer(file, fileUri, source));
                    if (result) {
                        if (result[1].size) {
                            await this.writeSourceMaps(fileUri, result[1], file);
                        }
                        source = result[0];
                    }
                }
                file.sourceUTF8 = source;
                break;
            }
            case 'text/javascript': {
                const trailing = await this.getTrailingContent(file);
                const bundle = this.getBundleContent(fileUri);
                if (!trailing && !bundle && !format) {
                    break;
                }
                let source = this.getUTF8String(file, fileUri);
                if (trailing) {
                    source += trailing;
                }
                if (bundle) {
                    source += bundle;
                }
                if (format && chrome) {
                    const result = await chrome.transform('js', format, source, chrome.createTransformer(file, fileUri, source));
                    if (result) {
                        if (result[1].size) {
                            await this.writeSourceMaps(fileUri, result[1], file);
                        }
                        source = result[0];
                    }
                }
                file.sourceUTF8 = source;
                break;
            }
            default:
                if (mimeType && mimeType.startsWith('image/')) {
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
    writeBuffer(data: FileData) {
        if (this.Compress) {
            const png = Compress.hasImageService() && Compress.findFormat(data.file.compress, 'png');
            if (png && Compress.withinSizeRange(data.fileUri, png.condition)) {
                try {
                    Compress.tryImage(data.fileUri, (result: string, err: Null<Error>) => {
                        if (err) {
                            throw err;
                        }
                        if (result) {
                            data.fileUri = result;
                            delete data.file.buffer;
                        }
                        this.finalizeAsset(data);
                    });
                }
                catch (err) {
                    this.writeFail(data.fileUri, err);
                    this.finalizeAsset(data);
                }
                return;
            }
        }
        this.finalizeAsset(data);
    }
    finalizeImage(data: FileData, output: string, command: string, compress?: CompressFormat, error?: Null<Error>) {
        if (error) {
            this.writeFail(output, error);
            this.completeAsyncTask();
        }
        else {
            const { file, fileUri } = data;
            let parent: Undef<ExternalAsset>;
            if (fileUri !== output) {
                if (command.includes('@')) {
                    if (!file.originalName) {
                        this.replace(file, output);
                    }
                    else {
                        parent = file;
                    }
                }
                else if (command.includes('%')) {
                    if (this.filesToCompare.has(file)) {
                        this.filesToCompare.get(file)!.push(output);
                    }
                    else {
                        this.filesToCompare.set(file, [output]);
                    }
                }
                else {
                    parent = file;
                }
            }
            if (compress) {
                Compress.tryImage(output, (result: string, err: Null<Error>) => {
                    if (err) {
                        this.writeFail(output, err);
                    }
                    this.completeAsyncTask(result || output, parent);
                });
            }
            else {
                this.completeAsyncTask(output, parent);
            }
        }
    }
    async finalizeAsset(data: FileData, parent?: ExternalAsset) {
        await this.transformBuffer(data);
        this.completeAsyncTask(data.fileUri, parent);
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
                const queue = processing[fileUri];
                if (queue) {
                    this.performAsyncTask();
                    queue.push(file);
                    return true;
                }
                processing[fileUri] = [file];
            }
            return false;
        };
        const processQueue = async (file: ExternalAsset, fileUri: string, bundleMain?: ExternalAsset) => {
            if (file.bundleIndex !== undefined) {
                let cloudStorage: Undef<CloudService[]>;
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
                            file.bundleIndex = NaN;
                            file.exclude = true;
                            file.invalid = true;
                            cloudStorage = file.cloudStorage;
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
                                queue!.cloudStorage = cloudStorage;
                                bundleMain = queue;
                            }
                            else {
                                queue!.invalid = true;
                            }
                        };
                        const resumeQueue = () => processQueue(queue!, fileUri, bundleMain);
                        if (queue.content) {
                            verifyBundle(queue.content).then(resumeQueue);
                        }
                        else if (uri) {
                            request(uri, (err, response) => {
                                if (err) {
                                    this.writeFail(uri, err);
                                    notFound[uri] = true;
                                    queue!.invalid = true;
                                    resumeQueue();
                                }
                                else {
                                    const statusCode = response.statusCode;
                                    if (statusCode >= 300) {
                                        this.writeFail(uri, statusCode + ' ' + response.statusMessage);
                                        notFound[uri] = true;
                                        queue!.invalid = true;
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
                    this.finalizeAsset({ file: bundleMain || file, fileUri });
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
            this.writeFail(uri, message);
            file.invalid = true;
            delete processing[fileUri];
        };
        for (const file of this.assets) {
            if (file.exclude) {
                file.invalid = true;
                continue;
            }
            if (file.filename.startsWith('__assign__')) {
                file.filename = uuid.v4() + path.extname(file.filename);
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
                    this.writeFail(pathname, err);
                    file.invalid = true;
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
                                    if (Buffer.isBuffer(data)) {
                                        file.buffer = file.buffer ? Buffer.concat([file.buffer, data]) : data;
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
    async finalize() {
        let tasks: Promise<unknown>[] = [];
        if (this.Chrome) {
            const inlineMap: StringMap = {};
            const base64Map: StringMap = {};
            const htmlFiles = this.getHtmlPages();
            if (htmlFiles.length) {
                for (const item of this.assets) {
                    if (item.inlineContent && item.inlineContent.startsWith('<!--')) {
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
                    await Promise.all(tasks).then(() => {
                        for (const item of htmlFiles) {
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
                    .catch(err => this.writeFail('Finalize: Inline UTF-8', err));
                    tasks = [];
                }
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
                if (!item.inlineBase64 || item.invalid) {
                    continue;
                }
                const mimeType = mime.lookup(item.fileUri!) || item.mimeType!;
                tasks.push(
                    fs.readFile(item.fileUri!).then((data: Buffer) => {
                        base64Map[item.inlineBase64!] = `data:${mimeType};base64,${data.toString('base64')}`;
                        item.invalid = true;
                    })
                );
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail('Finalize: Cache base64', err));
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
                        case '@text/css':
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
                await Promise.all(tasks).catch(err => this.writeFail('Finalize: Replace UTF-8', err));
                tasks = [];
            }
            for (const item of assets) {
                if (item.sourceUTF8) {
                    tasks.push(fs.writeFile(item.fileUri!, item.sourceUTF8, 'utf8'));
                }
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail('Finalize: Write UTF-8', err));
                tasks = [];
            }
        }
        for (const value of this.filesToRemove) {
            tasks.push(fs.unlink(value).then(() => this.delete(value)));
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => this.writeFail('Finalize: Delete temp files', err));
            tasks = [];
        }
        if (this.Gulp) {
            const gulp = this.Gulp;
            const taskMap = new Map<string, Map<string, GulpData>>();
            const origMap = new Map<string, string[]>();
            for (const item of this.assets) {
                if (!item.tasks || item.invalid) {
                    continue;
                }
                const origDir = path.dirname(item.fileUri!);
                const scheduled = new Set<string>();
                for (let task of item.tasks) {
                    if (!scheduled.has(task = task.trim()) && gulp[task]) {
                        const gulpfile = path.resolve(gulp[task]!);
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
                                                            this.writeFail('gulp: Unable to replace original files', errWrite);
                                                            callback();
                                                        });
                                                }
                                            });
                                        })
                                        .catch(error => this.writeFail('gulp: Unable to delete original files', error));
                                }
                                else {
                                    this.writeFail(`gulp: exec (${task}:${path.basename(data.gulpfile)})`, err);
                                    callback();
                                }
                            });
                        })
                        .catch(err => this.writeFail('gulp: Unable to copy original files', err));
                }
                catch (err) {
                    this.writeFail(`gulp: ${task}`, err);
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
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail('Finalize: exec tasks', err));
                tasks = [];
            }
        }
        if (this.Cloud) {
            const cloudSettings = this.Cloud.settings;
            const cloudMap: ObjectMap<ExternalAsset> = {};
            const cloudCssMap: StringMap = {};
            const localStorage = new Map<ExternalAsset, CloudService>();
            const filenameMap: ObjectMap<boolean> = {};
            const htmlFiles = this.getHtmlPages();
            const cssFiles: ExternalAsset[] = [];
            const getFiles = (item: ExternalAsset, data: CloudService) => {
                const files = [item.fileUri!];
                if (item.transforms && data.uploadAll) {
                    files.push(...item.transforms);
                }
                return files;
            };
            const uploadFiles = (item: ExternalAsset, mimeType?: string) => {
                const cloudMain = Cloud.getService(item.cloudStorage);
                for (const data of item.cloudStorage!) {
                    if (Cloud.hasService(data)) {
                        if (data === cloudMain && data.localStorage === false) {
                            localStorage.set(item, data);
                        }
                        if (!mimeType) {
                            mimeType = item.mimeType;
                        }
                        tasks.push(new Promise(resolve => {
                            const service = data.service;
                            const settings = cloudSettings[service];
                            const config = {} as CloudService;
                            if (settings && data.settings) {
                                Object.assign(config, settings[data.settings]);
                            }
                            Object.assign(config, data);
                            let uploadHandler: Undef<CloudServiceUpload>;
                            try {
                                cloudUploadHostMap[service] ||= require(`../cloud/${service}/upload`);
                                uploadHandler = cloudUploadHostMap[service].call(this, config);
                            }
                            catch (err) {
                                this.writeFail(`${service} does not support upload function.`, err);
                            }
                            if (typeof uploadHandler !== 'function') {
                                resolve();
                                return;
                            }
                            const upload: Promise<string>[] = [];
                            const files = getFiles(item, data);
                            for (let i = 0, length = files.length; i < length; ++i) {
                                const fileUri = files[i];
                                if (i === 0 || this.has(fileUri)) {
                                    upload.push(
                                        new Promise(success => {
                                            fs.readFile(fileUri, (err, buffer) => {
                                                if (err) {
                                                    success('');
                                                }
                                                else {
                                                    let filename: string,
                                                        j = 0;
                                                    do {
                                                        if (length > 1 && mimeType && mimeType.includes('text/')) {
                                                            filename = path.basename(fileUri);
                                                        }
                                                        else {
                                                            filename = i === 0 && config.filename || (uuid.v4() + path.extname(fileUri));
                                                        }
                                                        if (j > 0) {
                                                            filename = path.basename(fileUri).split('.').map((value, index) => value + (index === 0 ? '_' + j : '')).join('.');
                                                        }
                                                    }
                                                    while (filenameMap[filename] && ++j);
                                                    filenameMap[filename] = true;
                                                    uploadHandler!(buffer, success, { config, fileUri, filename, mimeType });
                                                }
                                            });
                                        })
                                    );
                                }
                            }
                            Promise.all(upload)
                                .then(result => {
                                    const fileUri = result[0];
                                    if (fileUri && data === cloudMain) {
                                        if (item.inlineCloud) {
                                            for (const content of htmlFiles) {
                                                content.sourceUTF8 = this.getUTF8String(content).replace(item.inlineCloud, fileUri);
                                                delete cloudMap[item.inlineCloud];
                                            }
                                        }
                                        else if (item.inlineCssCloud) {
                                            for (const content of htmlFiles) {
                                                content.sourceUTF8 = this.getUTF8String(content).replace(new RegExp(item.inlineCssCloud, 'g'), fileUri);
                                            }
                                            cloudCssMap[item.inlineCssCloud] = fileUri;
                                        }
                                    }
                                    resolve();
                                })
                                .catch(() => resolve());
                        }));
                    }
                }
            };
            let modifiedHtml: Undef<boolean>;
            for (const item of this.assets) {
                if (!item.cloudStorage || item.invalid) {
                    continue;
                }
                if (item.inlineCloud) {
                    cloudMap[item.inlineCloud] = item;
                    modifiedHtml = true;
                }
                switch (item.mimeType) {
                    case '@text/html':
                        htmlFiles.push(item);
                        break;
                    case '@text/css':
                        cssFiles.push(item);
                        break;
                    default:
                        uploadFiles(item);
                        break;
                }
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail('Finalize: Upload raw assets to cloud storage', err));
                tasks = [];
            }
            if (Object.keys(cloudCssMap).length) {
                for (const item of cssFiles) {
                    tasks.push(
                        new Promise(resolve => {
                            fs.readFile(item.fileUri!, 'utf8')
                                .then(content => {
                                    for (const id in cloudCssMap) {
                                        content = content.replace(new RegExp(id, 'g'), cloudCssMap[id]!);
                                    }
                                    fs.writeFile(item.fileUri!, content, 'utf8', () => resolve());
                                })
                                .catch(() => resolve());
                        })
                    );
                }
                if (tasks.length) {
                    await Promise.all(tasks);
                    tasks = [];
                }
            }
            for (const item of cssFiles) {
                if (item.cloudStorage) {
                    uploadFiles(item, 'text/css');
                }
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail('Finalize: Upload CSS to cloud storage', err));
                tasks = [];
            }
            if (modifiedHtml) {
                for (const content of htmlFiles) {
                    let sourceUTF8 = this.getUTF8String(content);
                    for (const id in cloudMap) {
                        const file = cloudMap[id];
                        sourceUTF8 = sourceUTF8.replace(id, this.getFileUri(file));
                        localStorage.delete(file);
                    }
                    fs.writeFileSync(content.fileUri!, sourceUTF8, 'utf8');
                }
            }
            const emptyDir = new Set<string>();
            for (const [item, data] of localStorage) {
                tasks.push(
                    ...getFiles(item, data).map(value => fs.unlink(value)
                        .then(() => {
                            let dir = this.dirname;
                            for (const seg of path.dirname(value).substring(this.dirname.length + 1).split(/[\\/]/)) {
                                dir += path.sep + seg;
                                emptyDir.add(dir);
                            }
                            this.delete(value);
                        })
                        .catch(() => this.delete(value)))
                );
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail('Finalize: Delete cloud temp files', err));
                tasks = [];
                for (const value of Array.from(emptyDir).reverse()) {
                    try {
                        fs.rmdirSync(value);
                    }
                    catch {
                    }
                }
            }
        }
        if (this.Compress) {
            for (const item of this.assets) {
                if (item.invalid) {
                    continue;
                }
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
        }
        return Promise.all(tasks).catch(err => {
            this.writeFail('Finalize: Compress files', err);
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