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
import Watch from '../watch';

type IFileManager = functions.IFileManager;
type IChrome = functions.IChrome;
type IWatch = functions.IWatch;

type Settings = functions.Settings;
type RequestBody = functions.RequestBody;
type ExternalAsset = functions.ExternalAsset;

type ResponseData = functions.squared.ResponseData;
type CompressFormat = functions.squared.CompressFormat;
type CloudService = functions.squared.CloudService;
type CloudServiceUpload = functions.squared.CloudServiceUpload;

type CompressModule = functions.settings.CompressModule;
type CloudModule = functions.settings.CloudModule;
type GulpModule = functions.settings.GulpModule;
type ChromeModule = functions.settings.ChromeModule;
type FileData = functions.internal.FileData;
type FileOutput = functions.internal.FileOutput;
type SourceMapOutput = functions.internal.Chrome.SourceMapOutput;
type UploadCallback = functions.internal.Cloud.UploadCallback;

interface GulpData {
    gulpfile: string;
    items: string[];
}

interface GulpTask {
    task: string;
    origDir: string;
    data: GulpData;
}

const getRelativePath = (file: ExternalAsset, filename = file.filename) => Node.toPosix(path.join(file.moveTo || '', file.pathname, filename));

const FileManager = class extends Module implements IFileManager {
    public static loadSettings(value: Settings, ignorePermissions?: boolean) {
        if (!ignorePermissions) {
            const { disk_read, disk_write, unc_read, unc_write } = value;
            if (disk_read === true || disk_read === 'true') {
                Node.setDiskRead();
            }
            if (disk_write === true || disk_write === 'true') {
                Node.setDiskWrite();
            }
            if (unc_read === true || unc_read === 'true') {
                Node.setUNCRead();
            }
            if (unc_write === true || unc_write === 'true') {
                Node.setUNCWrite();
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
            if (!Node.hasUNCWrite()) {
                if (res) {
                    res.json({ success: false, error: { hint: 'OPTION: --unc-write', message: 'Writing to UNC shares is not enabled.' } } as ResponseData);
                }
                return false;
            }
        }
        else if (!Node.hasDiskWrite()) {
            if (res) {
                res.json({ success: false, error: { hint: 'OPTION: --disk-write', message: 'Writing to disk is not enabled.' } } as ResponseData);
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
                res.json({ success: false, error: { hint: `DIRECTORY: ${dirname}`, message: err.toString() } } as ResponseData);
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
    public Chrome?: IChrome;
    public Cloud?: CloudModule;
    public Compress?: CompressModule;
    public Gulp?: GulpModule;
    public Watch?: IWatch;
    public baseUrl?: string;
    public baseAsset?: ExternalAsset;
    public readonly assets: ExternalAsset[];
    public readonly files = new Set<string>();
    public readonly filesQueued = new Set<string>();
    public readonly filesToRemove = new Set<string>();
    public readonly filesToCompare = new Map<ExternalAsset, string[]>();
    public readonly contentToAppend = new Map<string, string[]>();
    public readonly postFinalize: FunctionType<void>;

    constructor(
        public readonly dirname: string,
        private readonly _body: RequestBody,
        postFinalize: FunctionType<void> = () => undefined)
    {
        super();
        this.assets = this._body.assets;
        this.postFinalize = postFinalize.bind(this);
    }

    install(name: string, ...args: unknown[]) {
        switch (name) {
            case 'compress':
                this.Compress = args[0] as CompressModule;
                break;
            case 'cloud':
                this.Cloud = Cloud.settings;
                Cloud.settings = args[0] as CloudModule;
                break;
            case 'gulp':
                this.Gulp = args[0] as GulpModule;
                break;
            case 'chrome': {
                this.Chrome = new Chrome(args[0] as ChromeModule, this._body);
                const baseAsset = this.assets.find(item => item.baseUrl);
                if (baseAsset) {
                    this.baseAsset = baseAsset;
                    this.baseUrl = baseAsset.baseUrl;
                    this.assets.sort((a, b) => {
                        if (a.bundleId && a.bundleId === b.bundleId) {
                            return a.bundleIndex! - b.bundleIndex!;
                        }
                        if (a === baseAsset) {
                            return 1;
                        }
                        if (b === baseAsset) {
                            return -1;
                        }
                        return 0;
                    });
                }
                break;
            }
            case 'watch':
                this.Watch = Watch;
                if (typeof args[0] === 'number' && args[0] > 0) {
                    Watch.interval = args[0];
                }
                Watch.whenModified = (assets: ExternalAsset[]) => {
                    const manager = new FileManager(this.dirname, { ...this._body, assets });
                    if (this.Compress) {
                        manager.install('compress', this.Compress);
                    }
                    if (this.Cloud) {
                        manager.install('cloud', this.Cloud);
                    }
                    if (this.Gulp) {
                        manager.install('gulp', this.Gulp);
                    }
                    if (this.Chrome) {
                        manager.install('chrome', this.Chrome.settings);
                    }
                    manager.processAssets();
                };
                break;
        }
    }
    add(value: string, parent?: ExternalAsset) {
        if (value) {
            this.files.add(this.removeCwd(value));
            if (parent) {
                (parent.transforms ||= []).push(value);
            }
        }
    }
    delete(value: string) {
        this.files.delete(this.removeCwd(value));
    }
    has(value: Undef<string>) {
        return value ? this.files.has(this.removeCwd(value)) : false;
    }
    replace(file: ExternalAsset, replaceWith: string) {
        const fileUri = file.fileUri;
        if (fileUri) {
            if (replaceWith.includes('__copy__') && path.extname(fileUri) === path.extname(replaceWith)) {
                try {
                    fs.renameSync(replaceWith, fileUri);
                }
                catch (err) {
                    this.writeFail(['Unable to rename file', replaceWith], err);
                }
            }
            else {
                file.originalName ||= file.filename;
                file.filename = path.basename(replaceWith);
                file.fileUri = this.setFileUri(file).fileUri;
                file.relativePath = getRelativePath(file);
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
    replaceUri(source: string, segments: string[], value: string, matchSingle = true, base64?: boolean) {
        let output: Undef<string>;
        for (let segment of segments) {
            segment = !base64 ? this.escapePosix(segment) : `[^"',]+,\\s*` + segment;
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
    setFileUri(file: ExternalAsset): FileOutput {
        this.assignFilename(file);
        const pathname = path.join(this.dirname, file.moveTo || '', file.pathname);
        const fileUri = path.join(pathname, file.filename);
        file.fileUri = fileUri;
        file.relativePath = getRelativePath(file);
        return { pathname, fileUri };
    }
    relativePosix(file: ExternalAsset, uri: string) {
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
                        return Node.toPosix(path.join(asset.pathname, asset.filename));
                    }
                }
                else if (rootDir) {
                    if (baseDir === rootDir + asset.pathname) {
                        return asset.filename;
                    }
                    else if (baseDir === rootDir) {
                        return Node.toPosix(path.join(asset.pathname, asset.filename));
                    }
                }
                else {
                    const [originDir, uriDir] = this.getRootDirectory(Node.parsePath(origin)!, Node.parsePath(asset.uri!)!);
                    return '../'.repeat(originDir.length - 1) + uriDir.join('/');
                }
            }
            if (baseAsset && Node.fromSameOrigin(origin, baseAsset.uri!)) {
                const [originDir] = this.getRootDirectory(baseDir + '/' + file.filename, Node.parsePath(baseAsset.uri!)!);
                return '../'.repeat(originDir.length - 1) + asset.relativePath;
            }
        }
    }
    absolutePath(value: string, href: string) {
        value = Node.toPosix(value);
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
    assignFilename(file: ExternalAsset | CloudServiceUpload) {
        const filename = file.filename!;
        return filename.startsWith('__assign__') ? file.filename = uuid.v4() + path.extname(filename) : filename;
    }
    removeCwd(value: Undef<string>) {
        return value ? value.substring(this.dirname.length + 1) : '';
    }
    getUTF8String(file: ExternalAsset, fileUri = file.fileUri) {
        if (!file.sourceUTF8) {
            if (file.buffer) {
                file.sourceUTF8 = file.buffer.toString('utf8');
            }
            try {
                file.sourceUTF8 = fs.readFileSync(fileUri!, 'utf8');
            }
            catch (err) {
                this.writeFail(['File not found', fileUri!], err);
            }
        }
        return file.sourceUTF8 || '';
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
        const getCloudUUID = (item: Undef<ExternalAsset>, url: string) => {
            if (item && Cloud.getService('upload', item.cloudStorage)) {
                if (!item.inlineCssCloud) {
                    (file.inlineCssMap ||= {})[item.inlineCssCloud = uuid.v4()] = url;
                }
                return item.inlineCssCloud;
            }
            return url;
        };
        let output: Undef<string>;
        for (const item of this.assets) {
            if (item.base64 && item.uri && !item.textContent && !item.invalid) {
                const url = this.relativePosix(file, item.uri);
                if (url) {
                    const replaced = this.replaceUri(output || source, [item.base64.replace(/\+/g, '\\+')], getCloudUUID(item, url), false, true);
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
                let location = this.relativePosix(file, url);
                if (location) {
                    const uri = Node.resolvePath(url, fileUri);
                    output = (output || source).replace(match[0], `url(${getCloudUUID(uri ? this.findAsset(uri) : undefined, location)})`);
                }
                else if (baseUri) {
                    location = Node.resolvePath(url, baseUri);
                    if (location) {
                        const asset = this.findAsset(location);
                        if (asset) {
                            location = this.relativePosix(file, location);
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
                    const count = pathname && pathname !== '/' && !file.baseUrl ? pathname.split(/[\\/]/).length : 0;
                    output = (output || source).replace(match[0], `url(${getCloudUUID(asset, (count ? '../'.repeat(count) : '') + asset.relativePath)})`);
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
    writeSourceMap(file: ExternalAsset, fileUri: string, sourceData: [string, Map<string, SourceMapOutput>], sourceContent: string, modified: boolean) {
        const items = Array.from(sourceData[1]);
        const excludeSources = items.some(data => data[1].sourcesContent === null);
        const [name, data] = items.pop()!;
        const filename = path.basename(fileUri);
        const map = data.map;
        const mapFile = filename + '.map';
        map.file = filename;
        if (map.sourceRoot && file.bundleRoot && !modified) {
            const bundleRoot = file.bundleRoot;
            map.sources = this.assets.filter(item => item.bundleId === file.bundleId).sort((a, b) => a.bundleIndex! - b.bundleIndex!).map(item => item.uri!.replace(bundleRoot, ''));
        }
        else {
            map.sources = ['unknown'];
        }
        if (!excludeSources) {
            if (!Array.isArray(map.sourcesContent) || map.sourcesContent.length === 1 && !map.sourcesContent[0]) {
                map.sourcesContent = [data.sourcesContent || sourceContent];
            }
        }
        else {
            delete map.sourcesContent;
        }
        sourceData[0] = sourceData[0].replace(/# sourceMappingURL=[\S\s]+$/, '# sourceMappingURL=' + mapFile);
        try {
            const mapUri = path.join(path.dirname(fileUri), mapFile);
            fs.writeFileSync(mapUri, JSON.stringify(map), 'utf8');
            this.add(mapUri, file);
        }
        catch (err) {
            this.writeFail(['Unable to generate source map', name], err);
        }
    }
    async transformBuffer(data: FileData) {
        const chrome = this.Chrome;
        const { file, fileUri } = data;
        const { format, mimeType } = file;
        switch (mimeType) {
            case '@text/html': {
                const minifySpace = (value: string) => value.replace(/(\s+|\/)/g, '');
                const getOuterHTML = (css: boolean, value: string) => css ? `<link rel="stylesheet" href="${value}" />` : `<script src="${value}"></script>`;
                const checkInlineOptions = (value: string) => /data-chrome-options="[^"]*?inline[^"]*"/.test(value);
                const baseUri = file.uri!;
                const saved = new Set<string>();
                let html = this.getUTF8String(file, fileUri),
                    source = html,
                    pattern = /(\s*)<(script|link|style)([^>]*?)(\s+data-chrome-file="\s*(save|export)As:\s*((?:[^"]|\\")+)")([^>]*)>(?:[\s\S]*?<\/\2>\n*)?/ig,
                    match: Null<RegExpExecArray>;
                while (match = pattern.exec(html)) {
                    const items = match[6].split('::').map(item => item.trim());
                    if (items[0] === '~') {
                        continue;
                    }
                    const location = this.absolutePath(items[0], baseUri);
                    if ((checkInlineOptions(match[3]) || checkInlineOptions(match[7])) && !saved.has(location)) {
                        saved.add(location);
                    }
                    else {
                        const script = match[2].toLowerCase() === 'script';
                        if (saved.has(location) || match[5] === 'export' && new RegExp(`<${script ? 'script' : 'link'}[^>]+?(?:${script ? 'src' : 'href'}=(["'])${location}\\1|data-chrome-file="saveAs:${location}[:"])[^>]*>`, 'i').test(html)) {
                            source = source.replace(match[0], '');
                        }
                        else if (match[5] === 'save') {
                            const content = match[0].replace(match[4], '');
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
                            replaceWith = `<${inlineContent}${attributes ? attributes.map(({ key, value }) => getAttribute(key, value)).join('') : ''}>${id}</${inlineContent}>`;
                            replaceTry();
                            replaceMinify();
                            if (replacing !== source) {
                                item.inlineContent = id;
                                item.watch = false;
                                if (item.fileUri) {
                                    this.filesToRemove.add(item.fileUri);
                                }
                            }
                        }
                        else if (bundleIndex === 0 || bundleIndex === -1) {
                            let value: string;
                            if (Cloud.getService('upload', item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            else {
                                value = item.relativePath!;
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
                            for (const { key, value } of attributes) {
                                match = new RegExp(`(\\s*)${key}(?:=(?:"([^"]|\\")*?"|'([^']|\\')*?')|\b)`).exec(output);
                                if (match) {
                                    output = output.replace(match[0], value !== undefined ? (match[1] ? ' ' : '') + getAttribute(key, value) : '');
                                }
                                else if (value !== undefined) {
                                    match = /^(\s*)<([\w-]+)(\s*)/.exec(output);
                                    if (match) {
                                        output = output.replace(match[0], match[1] + '<' + match[2] + ' ' + getAttribute(key, value) + (match[3] ? ' ' : ''));
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
                const baseUrl = this.baseUrl;
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
                                relativePath: Undef<string>,
                                ascending: Undef<boolean>;
                            if (baseUrl) {
                                relativePath = uri.replace(baseUrl, '');
                                if (relativePath === uri) {
                                    relativePath = '';
                                }
                            }
                            if (!relativePath && Node.fromSameOrigin(baseUri, uri)) {
                                relativePath = path.join(item.pathname, path.basename(uri));
                                ascending = true;
                            }
                            if (relativePath) {
                                segments.push(relativePath);
                            }
                            if (Cloud.getService('upload', item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            else if (item.mimeType.startsWith('image/') && item.format === 'base64') {
                                value = uuid.v4();
                                item.inlineBase64 = value;
                                item.watch = false;
                            }
                            else {
                                value = item.relativePath!;
                            }
                            const innerContent = textContent.replace(/^\s*<\s*/, '').replace(/\s*\/?\s*>([\S\s]*<\/\w+>)?\s*$/, '');
                            const replaced = this.replaceUri(innerContent, segments, value);
                            if (replaced) {
                                const result = source.replace(innerContent, replaced);
                                if (result !== source) {
                                    source = result;
                                    html = source;
                                    break found;
                                }
                            }
                            if (relativePath) {
                                pattern = new RegExp(`(["'\\s,=])(` + (ascending ? '(?:(?:\\.\\.)?(?:[\\\\/]\\.\\.|\\.\\.[\\\\/]|[\\\\/])*)?' : '') + this.escapePosix(relativePath) + ')', 'g');
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
                            if (Cloud.getService('upload', item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            else {
                                value = item.relativePath!;
                            }
                            const result = this.replaceUri(source, [item.base64.replace(/\+/g, '\\+')], value, false, true);
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
                    const result = await chrome.transform('html', format, source, chrome.createSourceMap(file, fileUri, source));
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
                    const result = await chrome.transform('html', format, source, chrome.createSourceMap(file, fileUri, source));
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
                let source = this.getUTF8String(file, fileUri),
                    modified = false;
                if (unusedStyles) {
                    const result = this.removeCss(source, unusedStyles);
                    if (result) {
                        source = result;
                        modified = true;
                    }
                }
                if (transform) {
                    const result = this.transformCss(file, source);
                    if (result) {
                        source = result;
                        modified = true;
                    }
                }
                if (trailing) {
                    source += trailing;
                    modified = true;
                }
                if (bundle) {
                    source += bundle;
                }
                if (format && chrome) {
                    const result = await chrome.transform('css', format, source, chrome.createSourceMap(file, fileUri, source));
                    if (result) {
                        if (result[1].size) {
                            this.writeSourceMap(file, fileUri, result, source, modified);
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
                let source = this.getUTF8String(file, fileUri),
                    modified = false;
                if (trailing) {
                    source += trailing;
                    modified = true;
                }
                if (bundle) {
                    source += bundle;
                }
                if (format && chrome) {
                    const result = await chrome.transform('js', format, source, chrome.createSourceMap(file, fileUri, source));
                    if (result) {
                        if (result[1].size) {
                            this.writeSourceMap(file, fileUri, result, source, modified);
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
                    this.writeFail(['Unable to copy file', fileUri], err);
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
        this.filesQueued.add(output ||= fileUri);
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
                    this.writeFail(['Unable to compress image', data.fileUri], err);
                    this.finalizeAsset(data);
                }
                return;
            }
        }
        this.finalizeAsset(data);
    }
    finalizeImage(data: FileData, output: string, command: string, compress?: CompressFormat, error?: Null<Error>) {
        if (error) {
            this.writeFail(['Unable to finalize image', output], error);
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
                        this.writeFail(['Unable to compress image', output], err);
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
                            request(uri, (err, res) => {
                                if (err || res.statusCode >= 300) {
                                    this.writeFail(['Unable to download file', uri], err || res.statusCode + ' ' + res.statusMessage);
                                    notFound[uri] = true;
                                    queue!.invalid = true;
                                    resumeQueue();
                                }
                                else {
                                    queue!.etag = (res.headers['etag'] || res.headers['last-modified']) as string;
                                    verifyBundle(res.body).then(resumeQueue);
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
        const errorRequest = (file: ExternalAsset, fileUri: string, err: Error | string, stream?: fs.WriteStream) => {
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
            this.writeFail(['Unable to download file', uri], err);
            file.invalid = true;
            delete processing[fileUri];
        };
        for (const file of this.assets) {
            if (file.exclude) {
                file.invalid = true;
                continue;
            }
            const { pathname, fileUri } = this.setFileUri(file);
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
                        this.writeFail(['Unable to empty directory', pathname], err);
                    }
                }
                try {
                    fs.mkdirpSync(pathname);
                }
                catch (err) {
                    this.writeFail(['Unable to create directory', pathname], err);
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
                                    if (this.Watch) {
                                        file.etag = (response.headers['etag'] || response.headers['last-modified']) as string;
                                    }
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
                    else if (Node.hasUNCRead() && Node.isFileUNC(uri) || Node.hasDiskRead() && path.isAbsolute(uri)) {
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
    async compressFile(file: ExternalAsset) {
        const fileUri = file.fileUri!;
        if (this.has(fileUri)) {
            const tasks: Promise<void>[] = [];
            const gz = Compress.findFormat(file.compress, 'gz');
            if (gz) {
                this.formatMessage('GZ', 'Compressing file...', fileUri + '.gz', 'yellow');
                tasks.push(
                    new Promise<void>(resolve => Compress.tryFile(fileUri, gz, null, (result: string) => {
                        if (result) {
                            this.add(result, file);
                        }
                        resolve();
                    }))
                );
            }
            if (Node.checkVersion(11, 7)) {
                const br = Compress.findFormat(file.compress, 'br');
                if (br) {
                    this.formatMessage('BR', 'Compressing file...', fileUri + '.br', 'yellow');
                    tasks.push(
                        new Promise<void>(resolve => Compress.tryFile(fileUri, br, null, (result: string) => {
                            if (result) {
                                this.add(result, file);
                            }
                            resolve();
                        }))
                    );
                }
            }
            if (tasks.length) {
                return Promise.all(tasks).catch(err => this.writeFail(['Compress', fileUri], err));
            }
        }
    }
    async finalize() {
        let tasks: Promise<unknown>[] = [];
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
        if (this.Chrome) {
            const inlineCssMap: StringMap = {};
            const base64Map: StringMap = {};
            const htmlFiles = this.getHtmlPages();
            if (htmlFiles.length) {
                for (const item of this.assets) {
                    if (item.inlineContent && item.inlineContent.startsWith('<!--')) {
                        const setContent = (value: string) => {
                            inlineCssMap[item.inlineContent!] = value.trim();
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
                                for (const id in inlineCssMap) {
                                    const value = inlineCssMap[id]!;
                                    content = content.replace(new RegExp((value.includes(' ') ? '[ \t]*' : '') + id), value);
                                }
                                item.sourceUTF8 = content;
                            }
                        }
                    })
                    .catch(err => this.writeFail(['Inline UTF-8', 'finalize'], err));
                    tasks = [];
                }
            }
            for (const item of this.assets) {
                if (item.inlineBase64 && !item.invalid) {
                    const mimeType = mime.lookup(item.fileUri!) || item.mimeType!;
                    tasks.push(
                        fs.readFile(item.fileUri!).then((data: Buffer) => {
                            base64Map[item.inlineBase64!] = `data:${mimeType};base64,${data.toString('base64')}`;
                            item.invalid = true;
                        })
                    );
                }
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail(['Cache base64', 'finalize'], err));
                tasks = [];
            }
            const replaced = this.assets.filter(item => item.originalName && !item.invalid);
            if (replaced.length || Object.keys(base64Map) || this.productionRelease) {
                const replaceContent = (file: ExternalAsset, value: string) => {
                    for (const id in base64Map) {
                        value = value.replace(new RegExp(id, 'g'), base64Map[id]!);
                    }
                    for (const asset of replaced) {
                        value = value.replace(new RegExp(this.escapePosix(getRelativePath(asset, asset.originalName)), 'g'), asset.relativePath!);
                    }
                    if (this.productionRelease) {
                        value = value.replace(new RegExp(`(\\.\\./)*${this.serverRoot}`, 'g'), '');
                    }
                    file.sourceUTF8 = value;
                };
                for (const item of this.assets) {
                    if (!item.invalid) {
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
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail(['Replace UTF-8', 'finalize'], err));
                tasks = [];
            }
        }
        for (const item of this.assets) {
            if (item.sourceUTF8 && !item.invalid) {
                tasks.push(fs.writeFile(item.fileUri!, item.sourceUTF8, 'utf8'));
            }
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => this.writeFail(['Write modified files', 'finalize'], err));
            tasks = [];
        }
        for (const value of this.filesToRemove) {
            tasks.push(
                fs.unlink(value)
                    .then(() => this.delete(value))
                    .catch(err => {
                        if (err.code !== 'ENOENT') {
                            throw err;
                        }
                    })
            );
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => this.writeFail(['Delete temp files', 'finalize'], err));
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
                            delete item.sourceUTF8;
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
            const resumeThread = (item: GulpTask, callback: (value?: unknown) => void) => {
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
                                                            this.writeFail(['Unable to replace original files', `gulp:${task}`], errWrite);
                                                            callback();
                                                        });
                                                }
                                            });
                                        })
                                        .catch(error => this.writeFail(['Unable to delete original files', `gulp:${task}`], error));
                                }
                                else {
                                    this.writeFail(['Exec', `gulp:${task}`], err);
                                    callback();
                                }
                            });
                        })
                        .catch(err => this.writeFail(['Unable to copy original files', `gulp:${task}`], err));
                }
                catch (err) {
                    this.writeFail(['Unknown', `gulp:${task}`], err);
                    callback();
                }
            };
            for (const item of itemsAsync) {
                tasks.push(new Promise(resolve => resumeThread(item, resolve)));
            }
            if (itemsSync.length) {
                tasks.push(new Promise<void>(resolve => {
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
                await Promise.all(tasks).catch(err => this.writeFail(['Exec tasks', 'finalize'], err));
                tasks = [];
            }
        }
        const compressMap = new WeakSet<ExternalAsset>();
        if (this.Cloud) {
            const cloudMap: ObjectMap<ExternalAsset> = {};
            const cloudCssMap: ObjectMap<ExternalAsset> = {};
            const localStorage = new Map<ExternalAsset, CloudServiceUpload>();
            const bucketGroup = uuid.v4();
            const htmlFiles = this.getHtmlPages();
            const cssFiles: ExternalAsset[] = [];
            const rawFiles: ExternalAsset[] = [];
            let endpoint: Undef<string>,
                modifiedHtml: Undef<boolean>,
                modifiedCss: Undef<Set<ExternalAsset>>;
            Cloud.setObjectKeys(this.assets);
            if (htmlFiles.length === 1) {
                const upload = Cloud.getService('upload', htmlFiles[0].cloudStorage)?.upload;
                if (upload && upload.endpoint) {
                    endpoint = this.toPosix(upload.endpoint) + '/';
                }
            }
            const getFiles = (item: ExternalAsset, data: CloudServiceUpload) => {
                const files = [item.fileUri!];
                const transforms: string[] = [];
                if (item.transforms && data.all) {
                    for (const value of item.transforms) {
                        if (/\.(map|gz|br)$/.test(value)) {
                            files.push(value);
                        }
                        else if (!item.cloudUri) {
                            transforms.push(value);
                        }
                    }
                }
                return [files, transforms];
            };
            const uploadFiles = (item: ExternalAsset, mimeType = item.mimeType) => {
                const cloudMain = Cloud.getService('upload', item.cloudStorage);
                for (const storage of item.cloudStorage!) {
                    if (Cloud.hasService('upload', storage)) {
                        const service = storage.service;
                        const upload = storage.upload!;
                        if (storage === cloudMain && upload.localStorage === false) {
                            localStorage.set(item, upload);
                        }
                        let uploadHandler: UploadCallback;
                        try {
                            uploadHandler = Cloud.getUploadHandler(Cloud.getCredential(storage), service);
                        }
                        catch (err) {
                            this.writeFail(['Upload function not supported', service], err);
                            continue;
                        }
                        tasks.push(new Promise<void>(resolve => {
                            const uploadTasks: Promise<string>[] = [];
                            const files = getFiles(item, upload);
                            for (let i = 0, length = files.length; i < length; ++i) {
                                const group = files[i];
                                for (const fileUri of group) {
                                    if (i === 0 || this.has(fileUri)) {
                                        const fileGroup: [Buffer | string, string][] = [];
                                        if (i === 0) {
                                            for (let j = 1; j < group.length; ++j) {
                                                try {
                                                    fileGroup.push([service === 'gcs' ? group[j] : fs.readFileSync(group[j]), path.extname(group[j])]);
                                                }
                                                catch (err) {
                                                    this.writeFail('File not found', err);
                                                }
                                            }
                                        }
                                        uploadTasks.push(
                                            new Promise(success => {
                                                fs.readFile(fileUri, (err, buffer) => {
                                                    if (!err) {
                                                        let filename: Undef<string>;
                                                        if (i === 0) {
                                                            if (item.cloudUri) {
                                                                filename = path.basename(item.cloudUri);
                                                            }
                                                            else if (upload.filename) {
                                                                filename = this.assignFilename(upload);
                                                            }
                                                            else if (upload.overwrite) {
                                                                filename = path.basename(fileUri);
                                                            }
                                                        }
                                                        uploadHandler({ buffer, service: storage, upload, fileUri, fileGroup, bucketGroup, filename, mimeType: mimeType || mime.lookup(fileUri) || undefined }, success);
                                                    }
                                                    else {
                                                        success('');
                                                    }
                                                });
                                            })
                                        );
                                        if (i === 0) {
                                            break;
                                        }
                                    }
                                }
                                Promise.all(uploadTasks)
                                    .then(result => {
                                        if (storage === cloudMain && result[0]) {
                                            let cloudUri = result[0];
                                            if (endpoint) {
                                                cloudUri = cloudUri.replace(new RegExp(escapeRegexp(endpoint), 'g'), '');
                                            }
                                            if (item.inlineCloud) {
                                                for (const content of htmlFiles) {
                                                    content.sourceUTF8 = this.getUTF8String(content).replace(item.inlineCloud, cloudUri);
                                                    delete cloudMap[item.inlineCloud];
                                                }
                                            }
                                            else if (item.inlineCssCloud) {
                                                const pattern = new RegExp(item.inlineCssCloud, 'g');
                                                for (const content of htmlFiles) {
                                                    content.sourceUTF8 = this.getUTF8String(content).replace(pattern, cloudUri);
                                                }
                                                if (endpoint && cloudUri.indexOf('/') !== -1) {
                                                    cloudUri = result[0];
                                                }
                                                for (const content of cssFiles) {
                                                    if (content.inlineCssMap) {
                                                        content.sourceUTF8 = this.getUTF8String(content).replace(pattern, cloudUri);
                                                        modifiedCss!.add(content);
                                                    }
                                                }
                                                delete cloudCssMap[item.inlineCssCloud];
                                            }
                                            item.cloudUri = cloudUri;
                                        }
                                        resolve();
                                    })
                                    .catch(() => resolve());
                            }
                        }));
                    }
                }
            };
            const bucketMap: ObjectMap<Map<string, PlainObject>> = {};
            for (const item of this.assets) {
                if (item.cloudStorage) {
                    if (item.fileUri) {
                        if (item.inlineCloud) {
                            cloudMap[item.inlineCloud] = item;
                            modifiedHtml = true;
                        }
                        else if (item.inlineCssCloud) {
                            cloudCssMap[item.inlineCssCloud] = item;
                            modifiedCss = new Set();
                        }
                        switch (item.mimeType) {
                            case '@text/html':
                                break;
                            case '@text/css':
                                cssFiles.push(item);
                                break;
                            default:
                                await this.compressFile(item);
                                compressMap.add(item);
                                rawFiles.push(item);
                                break;
                        }
                    }
                    for (const storage of item.cloudStorage) {
                        if (storage.admin?.emptyBucket && Cloud.hasCredential(storage) && storage.bucket && !(bucketMap[storage.service] ||= new Map()).has(storage.bucket)) {
                            bucketMap[storage.service].set(storage.bucket, Cloud.getCredential(storage));
                        }
                    }
                }
            }
            for (const service in bucketMap) {
                for (const [bucket, credential] of bucketMap[service]) {
                    tasks.push(Cloud.deleteObjects(credential, { service, bucket, credential }).catch(err => this.writeFail(['Cloud provider not found', service], err)));
                }
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail(['Empty buckets in cloud storage', 'finalize'], err));
                tasks = [];
            }
            for (const item of rawFiles) {
                uploadFiles(item);
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail(['Upload raw assets to cloud storage', 'finalize'], err));
                tasks = [];
            }
            if (modifiedCss) {
                for (const id in cloudCssMap) {
                    for (const item of cssFiles) {
                        const inlineCssMap = item.inlineCssMap;
                        if (inlineCssMap && inlineCssMap[id]) {
                            item.sourceUTF8 = this.getUTF8String(item).replace(new RegExp(id, 'g'), inlineCssMap[id]!);
                            modifiedCss.add(item);
                        }
                    }
                    localStorage.delete(cloudCssMap[id]);
                }
                if (modifiedCss.size) {
                    tasks.push(...Array.from(modifiedCss).map(item => fs.writeFile(item.fileUri!, item.sourceUTF8, 'utf8')));
                }
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail(['Update CSS', 'finalize'], err));
                tasks = [];
            }
            for (const item of cssFiles) {
                if (item.cloudStorage) {
                    await this.compressFile(item);
                    compressMap.add(item);
                    uploadFiles(item, 'text/css');
                }
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail(['Upload CSS to cloud storage', 'finalize'], err));
                tasks = [];
            }
            if (modifiedHtml) {
                for (const item of htmlFiles) {
                    let sourceUTF8 = this.getUTF8String(item);
                    for (const id in cloudMap) {
                        const file = cloudMap[id];
                        sourceUTF8 = sourceUTF8.replace(id, file.relativePath!);
                        localStorage.delete(file);
                    }
                    if (endpoint) {
                        sourceUTF8 = sourceUTF8.replace(endpoint, '');
                    }
                    try {
                        fs.writeFileSync(item.fileUri!, sourceUTF8, 'utf8');
                    }
                    catch (err) {
                        this.writeFail(['Update HTML', 'finalize'], err);
                    }
                    await this.compressFile(item);
                    compressMap.add(item);
                    if (item.cloudStorage) {
                        uploadFiles(item, 'text/html');
                    }
                }
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail(['Upload HTML to cloud storage', 'finalize'], err));
                tasks = [];
            }
            const emptyDir = new Set<string>();
            for (const [item, data] of localStorage) {
                for (const group of getFiles(item, data)) {
                    if (group.length) {
                        tasks.push(
                            ...group.map(value => {
                                return fs.unlink(value)
                                    .then(() => {
                                        let dir = this.dirname;
                                        for (const seg of path.dirname(value).substring(this.dirname.length + 1).split(/[\\/]/)) {
                                            dir += path.sep + seg;
                                            emptyDir.add(dir);
                                        }
                                        this.delete(value);
                                    })
                                    .catch(() => this.delete(value));
                            })
                        );
                    }
                }
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail(['Delete cloud temp files', 'finalize'], err));
                tasks = [];
                for (const value of Array.from(emptyDir).reverse()) {
                    try {
                        fs.rmdirSync(value);
                    }
                    catch {
                    }
                }
            }
            const downloadMap: ObjectMap<Set<string>> = {};
            for (const item of this.assets) {
                if (item.cloudStorage) {
                    for (const data of item.cloudStorage) {
                        if (Cloud.hasService('download', data)) {
                            const { active, pathname, filename, overwrite } = data.download!;
                            if (filename) {
                                const service = data.service.toUpperCase();
                                const fileUri = item.fileUri;
                                let valid = false,
                                    downloadUri = pathname ? path.join(this.dirname, pathname.replace(/^([A-Z]:)?[\\/]+/i, '')) : data.admin?.preservePath && fileUri ? path.join(path.dirname(fileUri), filename) : path.join(this.dirname, filename);
                                if (fs.existsSync(downloadUri)) {
                                    if (active || overwrite) {
                                        valid = true;
                                    }
                                }
                                else {
                                    if (active && fileUri && path.extname(fileUri) === path.extname(downloadUri)) {
                                        downloadUri = fileUri;
                                    }
                                    try {
                                        fs.mkdirpSync(path.dirname(downloadUri));
                                    }
                                    catch (err) {
                                        this.writeFail('Unable to create directory', err);
                                        continue;
                                    }
                                    valid = true;
                                }
                                if (valid) {
                                    const location = service + data.bucket + filename;
                                    if (downloadMap[location]) {
                                        downloadMap[location].add(downloadUri);
                                    }
                                    else {
                                        try {
                                            tasks.push(Cloud.downloadObject(Cloud.getCredential(data), data, (value: Null<Buffer | string>) => {
                                                if (value) {
                                                    try {
                                                        const items = Array.from(downloadMap[location]);
                                                        for (let i = 0, length = items.length; i < length; ++i) {
                                                            const destUri = items[i];
                                                            if (typeof value === 'string') {
                                                                fs[i === length - 1 ? 'moveSync' : 'copySync'](value, destUri, { overwrite: true });
                                                            }
                                                            else {
                                                                fs.writeFileSync(destUri, value);
                                                            }
                                                            this.add(destUri);
                                                        }
                                                    }
                                                    catch (err) {
                                                        this.writeFail(['Write buffer', service], err);
                                                    }
                                                }
                                            }, bucketGroup));
                                            downloadMap[location] = new Set<string>([downloadUri]);
                                        }
                                        catch (err) {
                                            this.writeFail(['Download function not supported', service], err);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail(['Download from cloud storage', 'finalize'], err));
                tasks = [];
            }
        }
        if (this.Compress) {
            for (const item of this.assets) {
                if (!compressMap.has(item) && !item.invalid) {
                    tasks.push(this.compressFile(item));
                }
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail(['Compress files', 'finalize'], err));
                tasks = [];
            }
        }
        if (this.Watch) {
            this.Watch.start(this.assets);
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileManager;
    module.exports.default = FileManager;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default FileManager;