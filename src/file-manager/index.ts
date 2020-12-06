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
import Chrome from '../chrome';
import Cloud from '../cloud';
import Watch from '../watch';

type IFileManager = functions.IFileManager;
type IChrome = functions.IChrome;
type ICloud = functions.ICloud;
type IWatch = functions.IWatch;

type ImageConstructor = functions.ImageConstructor;

type Settings = functions.Settings;
type RequestBody = functions.RequestBody;
type ExternalAsset = functions.ExternalAsset;

type ResponseData = functions.squared.ResponseData;
type CloudService = functions.squared.CloudService;
type CloudStorageUpload = functions.squared.CloudStorageUpload;

type CompressModule = functions.settings.CompressModule;
type CloudModule = functions.settings.CloudModule;
type GulpModule = functions.settings.GulpModule;
type ChromeModule = functions.settings.ChromeModule;

type FileData = functions.internal.FileData;
type FileOutput = functions.internal.FileOutput;
type UsingOptions = functions.internal.Image.UsingOptions;
type SourceMap = functions.internal.Chrome.SourceMap;
type SourceMapInput = functions.internal.Chrome.SourceMapInput;
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

const REGEXP_INDEXOBJECT = /([^[.\s]+)((?:\s*\[[^\]]+\]\s*)+)?\s*\.?\s*/g;
const REGEXP_INDEXARRAY = /\[\s*(["'])?(.+?)\1\s*\]/g;
const REGEXP_TAGTEXT = /^\s*<([\w-]+)[^>]*>[\S\s]*?<\/\1>\s*$/;
const REGEXP_TRAILINGCONTENT = /(\s*)<(script|style)[^>]*>([\s\S]*?)<\/\2>\n*/g;
const REGEXP_DBCOLUMN = /\$\{\s*(\w+)\s*\}/g;
const REGEXP_FILEEXCLUDE = /\s*<(script|link|style).+?data-chrome-file="exclude"[\s\S]*?<\/\1>\n*/g;
const REGEXP_FILEEXCLUDECLOSED = /\s*<(script|link).+?data-chrome-file="exclude"[^>]*>\n*/g;
const REGEXP_SCRIPTTEMPLATE = /\s*<script.+?data-chrome-template="([^"]|(?<=\\)")*"[\s\S]*?<\/script>\n*/g;
const REGEXP_CHROMEATTRIBUTE = /\s+data-(use|chrome-[\w-]+)="([^"]|(?<=\\)")*"/g;
const REGEXP_CSSURL = /url\(\s*([^)]+)\s*\)/g;

function removeFileCommands(value: string) {
    return value
        .replace(REGEXP_FILEEXCLUDE, '')
        .replace(REGEXP_FILEEXCLUDECLOSED, '')
        .replace(REGEXP_SCRIPTTEMPLATE, '')
        .replace(REGEXP_CHROMEATTRIBUTE, '');
}

function getObjectValue(data: PlainObject, key: string, joinString = ' ') {
    REGEXP_INDEXOBJECT.lastIndex = 0;
    let found = false,
        value: unknown = data,
        match: Null<RegExpMatchArray>;
    while (match = REGEXP_INDEXOBJECT.exec(key)) {
        if (isObject(value)) {
            value = value[match[1]];
            if (match[2]) {
                REGEXP_INDEXARRAY.lastIndex = 0;
                let index: Null<RegExpMatchArray>;
                while (index = REGEXP_INDEXARRAY.exec(match[2])) {
                    const attr = index[1] ? index[2] : index[2].trim();
                    if (index[1] && isObject(value) || /^\d+$/.test(attr) && (typeof value === 'string' || Array.isArray(value))) {
                        value = value[attr];
                    }
                    else {
                        return '';
                    }
                }
            }
            if (value !== undefined && value !== null) {
                found = true;
                continue;
            }
        }
        return '';
    }
    if (found) {
        if (Array.isArray(value)) {
            return value.join(joinString);
        }
        else if (typeof value === 'object') {
            return JSON.stringify(value);
        }
        return (value as string).toString();
    }
    return '';
}

function assignFilename(file: ExternalAsset | CloudStorageUpload) {
    const filename = file.filename;
    if (filename) {
        return filename.startsWith('__assign__') ? file.filename = uuid.v4() + filename.substring(10) : filename;
    }
}

function replaceUri(source: string, segments: string[], value: string, matchSingle = true, base64?: boolean) {
    let output: Undef<string>;
    for (let segment of segments) {
        segment = !base64 ? escapePosix(segment) : `[^"',]+,\\s*` + segment;
        const pattern = new RegExp(`(src|href|data|poster=)?(["'])?(\\s*)${segment}(\\s*)\\2?`, 'g');
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

function getRootDirectory(location: string, asset: string): [string[], string[]] {
    const locationDir = location.split(/[\\/]/);
    const assetDir = asset.split(/[\\/]/);
    while (locationDir.length && assetDir.length && locationDir[0] === assetDir[0]) {
        locationDir.shift();
        assetDir.shift();
    }
    return [locationDir.filter(value => value), assetDir];
}

const escapePosix = (value: string) => value.replace(/[\\/]/g, '[\\\\/]');
const isObject = (value: unknown): value is PlainObject => typeof value === 'object' && value !== null;
const getRelativePath = (file: ExternalAsset, filename = file.filename) => Node.joinPosix(file.moveTo || '', file.pathname, filename);

class FileManager extends Module implements IFileManager {
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
        super.loadSettings(value as PlainObject);
    }

    public static moduleNode() {
        return Node;
    }

    public static moduleCompress() {
        return Compress;
    }

    public static hasPermissions(dirname: string, res?: Response) {
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

    public delayed = 0;
    public cleared = false;
    public Image: Null<ImageConstructor> = null;
    public Chrome: Null<IChrome> = null;
    public Cloud: Null<ICloud> = null;
    public Watch: Null<IWatch> = null;
    public Compress: Null<CompressModule> = null;
    public Gulp: Null<GulpModule> = null;
    public readonly assets: ExternalAsset[];
    public readonly files = new Set<string>();
    public readonly filesQueued = new Set<string>();
    public readonly filesToRemove = new Set<string>();
    public readonly filesToCompare = new Map<ExternalAsset, string[]>();
    public readonly contentToAppend = new Map<string, string[]>();
    public readonly postFinalize: FunctionType<void>;
    public readonly baseAsset?: ExternalAsset;

    constructor(
        public readonly baseDirectory: string,
        public readonly body: RequestBody,
        postFinalize: FunctionType<void> = () => undefined)
    {
        super();
        this.assets = this.body.assets;
        this.postFinalize = postFinalize.bind(this);
        this.baseAsset = this.assets.find(item => item.baseUrl);
    }

    install(name: string, ...args: unknown[]) {
        switch (name) {
            case 'image':
                this.Image = args[0] as ImageConstructor;
                break;
            case 'chrome':
                this.Chrome = new Chrome(this.body, args[0] as ChromeModule, args[1] === true);
                this.assets.sort((a, b) => {
                    if (a.bundleId && a.bundleId === b.bundleId) {
                        return a.bundleIndex! - b.bundleIndex!;
                    }
                    if (a === this.baseAsset) {
                        return 1;
                    }
                    if (b === this.baseAsset) {
                        return -1;
                    }
                    return 0;
                });
                break;
            case 'cloud':
                this.Cloud = new Cloud(args[0] as CloudModule, this.body.database);
                break;
            case 'watch':
                this.Watch = Watch;
                if (typeof args[0] === 'number' && args[0] > 0) {
                    Watch.interval = args[0];
                }
                Watch.whenModified = (assets: ExternalAsset[]) => {
                    const manager = new FileManager(this.baseDirectory, { ...this.body, assets });
                    if (this.Chrome) {
                        manager.install('chrome', this.Chrome.settings);
                    }
                    if (this.Cloud) {
                        manager.install('cloud', this.Cloud.settings);
                    }
                    if (this.Compress) {
                        manager.install('compress', this.Compress);
                    }
                    if (this.Gulp) {
                        manager.install('gulp', this.Gulp);
                    }
                    manager.processAssets();
                };
                break;
            case 'compress':
                this.Compress = args[0] as CompressModule;
                break;
            case 'gulp':
                this.Gulp = args[0] as GulpModule;
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
                    this.writeFail(['Unable to rename file', path.basename(replaceWith)], err);
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
    getHtmlPages() {
        return this.assets.filter(item => item.mimeType === '@text/html');
    }
    setFileUri(file: ExternalAsset): FileOutput {
        assignFilename(file);
        const pathname = path.join(this.baseDirectory, file.moveTo || '', file.pathname);
        const fileUri = path.join(pathname, file.filename);
        file.fileUri = fileUri;
        file.relativePath = getRelativePath(file);
        return { pathname, fileUri };
    }
    findAsset(uri: string, fromElement?: boolean) {
        return this.assets.find(item => item.uri === uri && (fromElement && item.outerHTML || !fromElement && !item.outerHTML) && !item.invalid);
    }
    findRelativePath(file: ExternalAsset, uri: string) {
        const origin = file.uri!;
        let asset = this.findAsset(uri);
        if (!asset) {
            const location = Node.resolvePath(uri, origin);
            if (location) {
                asset = this.findAsset(location);
            }
        }
        if (asset) {
            const baseDir = (file.rootDir || '') + file.pathname;
            const baseAsset = this.baseAsset;
            if (Node.fromSameOrigin(origin, asset.uri!)) {
                const rootDir = asset.rootDir;
                if (asset.moveTo) {
                    if (file.moveTo === asset.moveTo) {
                        return this.joinPosix(asset.pathname, asset.filename);
                    }
                }
                else if (rootDir) {
                    if (baseDir === rootDir + asset.pathname) {
                        return asset.filename;
                    }
                    else if (baseDir === rootDir) {
                        return this.joinPosix(asset.pathname, asset.filename);
                    }
                }
                else {
                    const [originDir, uriDir] = getRootDirectory(Node.parsePath(origin)!, Node.parsePath(asset.uri!)!);
                    return '../'.repeat(originDir.length - 1) + uriDir.join('/');
                }
            }
            if (baseAsset && Node.fromSameOrigin(origin, baseAsset.uri!)) {
                const [originDir] = getRootDirectory(baseDir + '/' + file.filename, Node.parsePath(baseAsset.uri!)!);
                return '../'.repeat(originDir.length - 1) + asset.relativePath;
            }
        }
    }
    removeCwd(value: Undef<string>) {
        return value ? value.substring(this.baseDirectory.length + 1) : '';
    }
    getUTF8String(file: ExternalAsset, fileUri?: string) {
        if (!file.sourceUTF8) {
            if (file.buffer) {
                file.sourceUTF8 = file.buffer.toString('utf8');
            }
            if (fileUri ||= file.fileUri) {
                try {
                    file.sourceUTF8 = fs.readFileSync(fileUri, 'utf8');
                }
                catch (err) {
                    this.writeFail(['File not found', path.basename(fileUri)], err);
                }
            }
        }
        return file.sourceUTF8 || '';
    }
    async appendContent(file: ExternalAsset, fileUri: string, content: string, bundleIndex = 0) {
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
            if (item && this.Cloud?.getStorage('upload', item.cloudStorage)) {
                if (!item.inlineCssCloud) {
                    (file.inlineCssMap ||= {})[item.inlineCssCloud = uuid.v4()] = url;
                }
                return item.inlineCssCloud;
            }
            return url;
        };
        let output: Undef<string>;
        for (const item of this.assets) {
            if (item.base64 && item.uri && !item.outerHTML && !item.invalid) {
                const url = this.findRelativePath(file, item.uri);
                if (url) {
                    const replaced = replaceUri(output || source, [item.base64.replace(/\+/g, '\\+')], getCloudUUID(item, url), false, true);
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
        REGEXP_CSSURL.lastIndex = 0;
        const fileUri = file.uri!;
        const baseUri = this.baseAsset?.uri;
        let match: Null<RegExpExecArray>;
        while (match = REGEXP_CSSURL.exec(source)) {
            const url = match[1].replace(/^["']\s*/, '').replace(/\s*["']$/, '');
            if (!Node.isFileURI(url) || Node.fromSameOrigin(fileUri, url)) {
                let location = this.findRelativePath(file, url);
                if (location) {
                    const uri = Node.resolvePath(url, fileUri);
                    output = (output || source).replace(match[0], `url(${getCloudUUID(uri ? this.findAsset(uri) : undefined, location)})`);
                }
                else if (baseUri) {
                    location = Node.resolvePath(url, baseUri);
                    if (location) {
                        const asset = this.findAsset(location);
                        if (asset) {
                            location = this.findRelativePath(file, location);
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
    createSourceMap(file: ExternalAsset, fileUri: string, sourcesContent: string) {
        return Object.create({
            file,
            fileUri,
            sourcesContent,
            sourceMap: new Map<string, SourceMapOutput>(),
            "nextMap": function(this: SourceMapInput, name: string, map: SourceMap | string, value: string, includeContent = true) {
                if (typeof map === 'string') {
                    try {
                        map = JSON.parse(map) as SourceMap;
                    }
                    catch {
                        return false;
                    }
                }
                if (typeof map === 'object' && map.mappings) {
                    this.map = map;
                    this.sourceMap.set(name, { value, map, sourcesContent: includeContent ? this.sourcesContent : null });
                    return true;
                }
                return false;
            }
        }) as SourceMapInput;
    }
    writeSourceMap(outputData: [string, Map<string, SourceMapOutput>], file: ExternalAsset, fileUri: string, sourcesContent = '', modified?: boolean) {
        const items = Array.from(outputData[1]);
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
                map.sourcesContent = [data.sourcesContent || sourcesContent];
            }
        }
        else {
            delete map.sourcesContent;
        }
        outputData[0] = outputData[0].replace(/# sourceMappingURL=[\S\s]+$/, '# sourceMappingURL=' + mapFile);
        try {
            const mapUri = path.join(path.dirname(fileUri), mapFile);
            fs.writeFileSync(mapUri, JSON.stringify(map), 'utf8');
            this.add(mapUri, file);
        }
        catch (err) {
            this.writeFail(['Unable to generate source map', name], err);
        }
    }
    async transformSource(data: FileData, module = this.Chrome) {
        const { file, fileUri } = data;
        const { format, mimeType } = file;
        switch (mimeType) {
            case '@text/html': {
                let html = this.getUTF8String(file, fileUri),
                    source = html,
                    current = '',
                    match: Null<RegExpExecArray>;
                const minifySpace = (value: string) => value.replace(/(\s+|\/)/g, '');
                const getOuterHTML = (css: boolean, value: string) => css ? `<link rel="stylesheet" href="${value}" />` : `<script src="${value}"></script>`;
                const formatTag = (outerHTML: string) => outerHTML.replace(/"\s*>$/, '" />');
                const formatAttr = (key: string, value?: Null<string>) => value !== undefined ? key + (value !== null ? `="${value}"` : '') : '';
                const replaceTry = (outerHTML: string, replaceWith: string) => {
                    source = source.replace(outerHTML, replaceWith);
                    if (current === source) {
                        source = source.replace(formatTag(outerHTML), replaceWith);
                    }
                };
                const replaceMinify = (outerHTML: string, replaceWith: string, content?: string) => {
                    if (current === source) {
                        const tagName = /\s*<([\w-]+)/.exec(outerHTML)?.[1];
                        if (tagName) {
                            content &&= minifySpace(content);
                            outerHTML = minifySpace(outerHTML);
                            const innerHTML = new RegExp(`(\\s*)<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>\\n*`, 'g');
                            while (match = innerHTML.exec(html)) {
                                if (outerHTML === minifySpace(match[0]) || content && content === minifySpace(match[2])) {
                                    source = source.replace(match[0], (replaceWith ? match[1] : '') + replaceWith);
                                    break;
                                }
                            }
                        }
                    }
                    html = source;
                };
                const cloud = this.Cloud;
                if (cloud && cloud.database) {
                    const cacheKey = uuid.v4();
                    for (const item of cloud.database) {
                        const outerHTML = item.element?.outerHTML;
                        if (outerHTML) {
                            const result = await cloud.getDatabaseRows(item, cacheKey);
                            if (result.length) {
                                const template = item.value;
                                let replaceWith = '';
                                if (typeof template === 'string') {
                                    const forward = outerHTML.split('>');
                                    const opposing = outerHTML.split('<');
                                    let opening: Undef<string>,
                                        closing: Undef<string>;
                                    if (opposing.length === 1 || forward.length === 1) {
                                        match = /^(\s*)<([\w-]+)(.*?)\/?>(\s*)$/.exec(outerHTML);
                                        if (match) {
                                            opening = match[1] + '<' + match[2] + match[3] + '>';
                                            closing = `</${match[2]}>` + match[4];
                                        }
                                    }
                                    else if (opposing.length === 2 && forward.length === 2 && REGEXP_TAGTEXT.test(outerHTML)) {
                                        opening = forward[0] + '>';
                                        closing = '<' + opposing[1];
                                    }
                                    else {
                                        const value = outerHTML.replace(/\s+$/, '');
                                        let last = -1;
                                        for (let i = 0, quote = '', length = value.length; i < length; ++i) {
                                            const ch = value[i];
                                            if (ch === '=') {
                                                if (!quote) {
                                                    switch (value[i + 1]) {
                                                        case '"':
                                                            quote = '"';
                                                            ++i;
                                                            break;
                                                        case "'":
                                                            quote = "'";
                                                            ++i;
                                                            break;
                                                    }
                                                }
                                            }
                                            else if (ch === quote) {
                                                quote = '';
                                            }
                                            else if (ch === '>') {
                                                if (!quote) {
                                                    opening = outerHTML.substring(0, i + 1);
                                                    break;
                                                }
                                                if (i < length - 1) {
                                                    last = i;
                                                }
                                            }
                                        }
                                        if (!opening && last !== -1) {
                                            opening = outerHTML.substring(0, last + 1);
                                        }
                                        closing = outerHTML.substring(outerHTML.lastIndexOf('<'));
                                    }
                                    if (opening && closing) {
                                        let output = '';
                                        for (const row of result) {
                                            let value = template;
                                            REGEXP_DBCOLUMN.lastIndex = 0;
                                            while (match = REGEXP_DBCOLUMN.exec(template)) {
                                                value = value.replace(match[0], getObjectValue(row, match[1]));
                                            }
                                            output += value;
                                        }
                                        replaceWith = opening + output + closing;
                                    }
                                }
                                else {
                                    replaceWith = outerHTML;
                                    for (const attr in template) {
                                        let columns = template[attr]!;
                                        if (typeof columns === 'string') {
                                            columns = [columns];
                                        }
                                        for (const row of result) {
                                            let value = '',
                                                joinString = ' ';
                                            for (const col of columns) {
                                                if (col[0] === ':') {
                                                    const join = /^:join\((.*)\)$/.exec(col);
                                                    if (join) {
                                                        joinString = join[1];
                                                    }
                                                    continue;
                                                }
                                                value += (value ? joinString : '') + getObjectValue(row, col, joinString);
                                            }
                                            if (value) {
                                                const replacement = ' ' + formatAttr(attr, value);
                                                match = new RegExp(`\\s*${attr}="(?:[^"]|(?<=\\\\)")*"`).exec(replaceWith);
                                                replaceWith = match ? replaceWith.replace(match[0], replacement) : replaceWith.replace(/^(\s*<[\w-]+)(\s*)/, (...capture) => capture[1] + replacement + (capture[2] ? ' ' : ''));
                                                break;
                                            }
                                        }
                                    }
                                }
                                if (replaceWith && replaceWith !== outerHTML) {
                                    current = source;
                                    replaceTry(outerHTML, replaceWith);
                                    replaceMinify(outerHTML, replaceWith);
                                    if (current !== source) {
                                        for (const asset of this.assets) {
                                            if (asset.outerHTML === outerHTML) {
                                                asset.outerHTML = replaceWith;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    html = source;
                }
                const baseUri = file.uri!;
                html = source;
                for (const item of this.assets) {
                    if (item.invalid && !item.exclude) {
                        continue;
                    }
                    const { outerHTML, trailingContent } = item;
                    if (trailingContent) {
                        REGEXP_TRAILINGCONTENT.lastIndex = 0;
                        const content = trailingContent.map(innerHTML => minifySpace(innerHTML.value));
                        while (match = REGEXP_TRAILINGCONTENT.exec(html)) {
                            if (content.includes(minifySpace(match[3]))) {
                                source = source.replace(match[0], '');
                            }
                        }
                        html = source;
                    }
                    if (outerHTML) {
                        current = source;
                        const { content, bundleIndex, inlineContent, attributes = {} } = item;
                        let output = '';
                        if (inlineContent) {
                            const id = `<!-- ${uuid.v4()} -->`;
                            let replaceWith = '<' + inlineContent;
                            for (const key in attributes) {
                                replaceWith += formatAttr(key, attributes[key]);
                            }
                            replaceWith += `>${id}</${inlineContent}>`;
                            replaceTry(outerHTML, replaceWith);
                            replaceMinify(outerHTML, replaceWith, content);
                            if (current !== source) {
                                item.inlineContent = id;
                                item.watch = false;
                                item.outerHTML = replaceWith;
                                if (item.fileUri) {
                                    this.filesToRemove.add(item.fileUri);
                                }
                                continue;
                            }
                        }
                        else if (bundleIndex === 0 || bundleIndex === -1) {
                            let value: string;
                            if (cloud && cloud.getStorage('upload', item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            else {
                                value = item.relativePath!;
                            }
                            output = getOuterHTML(/^\s*<link\b/.test(outerHTML) || !!item.mimeType?.endsWith('/css'), value);
                        }
                        else if (item.exclude || bundleIndex !== undefined) {
                            source = source.replace(new RegExp(`\\s*${escapeRegexp(outerHTML)}\\n*`), '');
                            if (current === source) {
                                source = source.replace(new RegExp(`\\s*${escapeRegexp(formatTag(outerHTML))}\\n*`), '');
                                replaceMinify(outerHTML, '', content);
                            }
                            continue;
                        }
                        if (Object.keys(attributes).length || output) {
                            output ||= outerHTML;
                            for (const key in attributes) {
                                const value = attributes[key];
                                match = new RegExp(`(\\s*)${key}(?:="([^"]|(?<=\\\\)")*"|\b)`).exec(output);
                                if (match) {
                                    output = output.replace(match[0], value !== undefined ? (match[1] ? ' ' : '') + formatAttr(key, value) : '');
                                }
                                else if (value !== undefined) {
                                    match = /^(\s*<[\w-]+)(\s*)/.exec(output);
                                    if (match) {
                                        output = output.replace(match[0], match[1] + ' ' + formatAttr(key, value) + (match[2] ? ' ' : ''));
                                    }
                                }
                            }
                            if (output !== outerHTML) {
                                replaceTry(outerHTML, output);
                                replaceMinify(outerHTML, output, content);
                                if (current !== source) {
                                    item.outerHTML = output;
                                    continue;
                                }
                            }
                            delete item.inlineCloud;
                        }
                    }
                }
                const baseUrl = this.baseAsset?.baseUrl;
                for (const item of this.assets) {
                    if (item === file || item.content || item.bundleIndex !== undefined || item.inlineContent || !item.uri || item.invalid) {
                        continue;
                    }
                    found: {
                        const { uri, outerHTML } = item;
                        if (outerHTML) {
                            item.mimeType ||= mime.lookup(uri).toString();
                            const segments = [uri];
                            let value = item.relativePath!,
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
                            if (cloud && cloud.getStorage('upload', item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            else if (item.mimeType.startsWith('image/') && item.format === 'base64') {
                                value = uuid.v4();
                                item.inlineBase64 = value;
                                item.watch = false;
                            }
                            const innerContent = outerHTML.replace(/^\s*<\s*/, '').replace(/\s*\/?\s*>([\S\s]*<\/\w+>)?\s*$/, '');
                            const replaced = replaceUri(innerContent, segments, value);
                            if (replaced) {
                                const result = source.replace(innerContent, replaced);
                                if (result !== source) {
                                    source = result;
                                    html = source;
                                    break found;
                                }
                            }
                            if (relativePath) {
                                const directory = new RegExp(`(["'\\s,=])(` + (ascending ? '(?:(?:\\.\\.)?(?:[\\\\/]\\.\\.|\\.\\.[\\\\/]|[\\\\/])*)?' : '') + escapePosix(relativePath) + ')', 'g');
                                while (match = directory.exec(html)) {
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
                            let value = item.relativePath!;
                            if (cloud && cloud.getStorage('upload', item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            const result = replaceUri(source, [item.base64.replace(/\+/g, '\\+')], value, false, true);
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
                source = removeFileCommands(this.transformCss(file, source) || source);
                if (format && module) {
                    const result = await module.transform('html', format, source, this.createSourceMap(file, fileUri, source));
                    if (result) {
                        file.sourceUTF8 = result[0];
                        break;
                    }
                }
                file.sourceUTF8 = source;
                break;
            }
            case 'text/html':
                if (format && module) {
                    const source = this.getUTF8String(file, fileUri);
                    const result = await module.transform('html', format, source, this.createSourceMap(file, fileUri, source));
                    if (result) {
                        file.sourceUTF8 = result[0];
                    }
                }
                break;
            case 'text/css':
            case '@text/css': {
                const unusedStyles = file.preserve !== true && module?.unusedStyles;
                const transform = mimeType[0] === '@';
                const trailing = await this.getTrailingContent(file);
                const bundle = this.getBundleContent(fileUri);
                if (!unusedStyles && !transform && !trailing && !bundle && !format) {
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
                if (format && module) {
                    const result = await module.transform('css', format, source, this.createSourceMap(file, fileUri, source));
                    if (result) {
                        if (result[1].size) {
                            this.writeSourceMap(result, file, fileUri, source, modified);
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
                if (format && module) {
                    const result = await module.transform('js', format, source, this.createSourceMap(file, fileUri, source));
                    if (result) {
                        if (result[1].size) {
                            this.writeSourceMap(result, file, fileUri, source, modified);
                        }
                        source = result[0];
                    }
                }
                file.sourceUTF8 = source;
                break;
            }
        }
    }
    queueImage(data: FileData, outputType: string, saveAs: string, command = '') {
        const fileUri = data.fileUri;
        let output: Undef<string>;
        if (data.file.mimeType === outputType) {
            if (!command.includes('@') || this.filesQueued.has(fileUri)) {
                let i = 1;
                do {
                    output = Module.renameExt(fileUri, '__copy__.' + (i > 1 ? `(${i}).` : '') + saveAs);
                }
                while (this.filesQueued.has(output) && ++i);
                try {
                    fs.copyFileSync(fileUri, output);
                }
                catch (err) {
                    this.writeFail(['Unable to copy file', path.basename(fileUri)], err);
                    return '';
                }
            }
        }
        else {
            let i = 1;
            do {
                output = Module.renameExt(fileUri, (i > 1 ? `(${i}).` : '') + saveAs);
            }
            while (this.filesQueued.has(output) && ++i);
        }
        this.filesQueued.add(output ||= fileUri);
        return output;
    }
    async compressFile(file: ExternalAsset) {
        const fileUri = file.fileUri!;
        if (this.has(fileUri)) {
            const tasks: Promise<void>[] = [];
            const gz = Compress.findFormat(file.compress, 'gz');
            if (gz) {
                tasks.push(
                    new Promise<void>(resolve => Compress.tryFile(fileUri, gz, null, (result: string) => {
                        if (result) {
                            this.add(result, file);
                        }
                        resolve();
                    }))
                );
            }
            if (Node.supported(11, 7)) {
                const br = Compress.findFormat(file.compress, 'br');
                if (br) {
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
                return Promise.all(tasks).catch(err => this.writeFail(['Compress', path.basename(fileUri)], err));
            }
        }
    }
    writeBuffer(data: FileData) {
        if (this.Compress) {
            const png = Compress.hasImageService() && Compress.findFormat(data.file.compress, 'png');
            if (png && Compress.withinSizeRange(data.fileUri, png.condition)) {
                try {
                    Compress.tryImage(data.fileUri, (result: string) => {
                        if (result) {
                            data.fileUri = result;
                            delete data.file.buffer;
                        }
                        this.finalizeAsset(data);
                    });
                }
                catch (err) {
                    this.writeFail(['Unable to compress image', path.basename(data.fileUri)], err);
                    this.finalizeAsset(data);
                }
                return;
            }
        }
        this.finalizeAsset(data);
    }
    finalizeImage(options: UsingOptions, error?: Null<Error>) {
        const { data, output, command = '', compress } = options;
        if (error || !output) {
            this.writeFail(['Unable to finalize image', path.basename(output || '')], error);
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
                try {
                    Compress.tryImage(output, (result: string) => this.completeAsyncTask(result || output, parent));
                }
                catch (err) {
                    this.writeFail(['Unable to compress image', path.basename(output)], err);
                    this.completeAsyncTask(output, parent);
                }
            }
            else {
                this.completeAsyncTask(output, parent);
            }
        }
    }
    async finalizeAsset(data: FileData, parent?: ExternalAsset) {
        const { file, fileUri } = data;
        if (this.Image) {
            const mimeType = file.mimeType || mime.lookup(fileUri);
            if (mimeType && mimeType.startsWith('image/')) {
                let compress = Compress.hasImageService() ? Compress.findFormat(file.compress, 'png') : undefined;
                if (compress && !Compress.withinSizeRange(fileUri, compress.condition)) {
                    compress = undefined;
                }
                const callback = this.finalizeImage.bind(this);
                if (mimeType === 'image/unknown') {
                    try {
                        await this.Image.using.call(this, { data, compress, callback });
                    }
                    catch (err) {
                        this.writeFail(['Unable to read image buffer', path.basename(fileUri)], err);
                        file.invalid = true;
                    }
                }
                else if (file.commands) {
                    for (const command of file.commands) {
                        if (Compress.withinSizeRange(fileUri, command)) {
                            this.Image.using.call(this, { data, compress, command, callback });
                        }
                    }
                }
            }
        }
        if (this.Chrome) {
            await this.transformSource(data, this.Chrome);
        }
        if (file.invalid) {
            if (!file.bundleId) {
                try {
                    fs.unlinkSync(fileUri);
                }
                catch (err) {
                    this.writeFail(['Unable to delete file', path.basename(fileUri)], err);
                }
            }
            this.completeAsyncTask('');
        }
        else {
            this.completeAsyncTask(data.fileUri, parent);
        }
    }
    processAssets(emptyDirectory?: boolean) {
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
                        content = await this.appendContent(file, fileUri, content);
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
                        const verifyBundle = async (next: ExternalAsset, value: string) => {
                            if (bundleMain) {
                                return this.appendContent(next, fileUri, value, next.bundleIndex);
                            }
                            if (value) {
                                next.sourceUTF8 = await this.appendContent(next, fileUri, value) || value;
                                next.invalid = false;
                                next.cloudStorage = cloudStorage;
                                bundleMain = queue;
                            }
                            else {
                                next.invalid = true;
                            }
                        };
                        const resumeQueue = () => processQueue(queue!, fileUri, bundleMain);
                        const uri = queue.uri;
                        if (queue.content) {
                            verifyBundle(queue, queue.content).then(resumeQueue);
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
                                    verifyBundle(queue!, res.body).then(resumeQueue);
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
                if (emptyDirectory) {
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
                    fs.writeFile(fileUri, file.content, 'utf8', err => fileReceived(err));
                }
            }
            else if (file.base64) {
                this.performAsyncTask();
                fs.writeFile(fileUri, file.base64, 'base64', err => {
                    if (!err) {
                        this.writeBuffer({ file, fileUri });
                    }
                    else {
                        file.invalid = true;
                        this.completeAsyncTask();
                    }
                });
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
                            fs.copyFile(uri, fileUri, err => fileReceived(err));
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
        for (const [file, output] of this.filesToCompare) {
            const fileUri = file.fileUri!;
            let minFile = fileUri,
                minSize = Module.getFileSize(minFile);
            for (const other of output) {
                const size = Module.getFileSize(other);
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
            const productionRelease = this.Chrome.productionRelease;
            if (replaced.length || Object.keys(base64Map) || productionRelease) {
                const replaceContent = (file: ExternalAsset, value: string) => {
                    for (const id in base64Map) {
                        value = value.replace(new RegExp(id, 'g'), base64Map[id]!);
                    }
                    for (const asset of replaced) {
                        value = value.replace(new RegExp(escapePosix(getRelativePath(asset, asset.originalName)), 'g'), asset.relativePath!);
                    }
                    if (productionRelease) {
                        value = value.replace(new RegExp(`(\\.\\./)*${this.Chrome!.serverRoot}`, 'g'), '');
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
                    Promise.all(data.items.map(uri => fs.copyFile(uri, path.join(tempDir, path.basename(uri)))))
                        .then(() => {
                            this.formatMessage(this.logType.CHROME, 'gulp', ['Executing task...', task], data.gulpfile, { titleColor: 'magenta' });
                            const time = Date.now();
                            child_process.exec(`gulp ${task} --gulpfile "${data.gulpfile}" --cwd "${tempDir}"`, { cwd: process.cwd() }, err => {
                                if (!err) {
                                    Promise.all(data.items.map(uri => fs.unlink(uri).then(() => this.delete(uri))))
                                        .then(() => {
                                            fs.readdir(tempDir, (err_r, files) => {
                                                if (!err_r) {
                                                    Promise.all(
                                                        files.map(filename => {
                                                            const uri = path.join(origDir, filename);
                                                            return fs.move(path.join(tempDir, filename), uri, { overwrite: true }).then(() => this.add(uri));
                                                        }))
                                                        .then(() => {
                                                            this.writeTimeElapsed('gulp', task, time);
                                                            callback();
                                                        })
                                                        .catch(err_w => {
                                                            this.writeFail(['Unable to replace original files', `gulp: ${task}`], err_w);
                                                            callback();
                                                        });
                                                }
                                                else {
                                                    callback();
                                                }
                                            });
                                        })
                                        .catch(error => this.writeFail(['Unable to delete original files', `gulp: ${task}`], error));
                                }
                                else {
                                    this.writeFail(['Unknown', `gulp: ${task}`], err);
                                    callback();
                                }
                            });
                        })
                        .catch(err => this.writeFail(['Unable to copy original files', `gulp: ${task}`], err));
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
            const cloud = this.Cloud;
            const cloudMap: ObjectMap<ExternalAsset> = {};
            const cloudCssMap: ObjectMap<ExternalAsset> = {};
            const localStorage = new Map<ExternalAsset, CloudStorageUpload>();
            const bucketGroup = uuid.v4();
            const htmlFiles = this.getHtmlPages();
            const cssFiles: ExternalAsset[] = [];
            const rawFiles: ExternalAsset[] = [];
            let endpoint: Undef<string>,
                modifiedHtml: Undef<boolean>,
                modifiedCss: Undef<Set<ExternalAsset>>;
            cloud.setObjectKeys(this.assets);
            if (htmlFiles.length === 1) {
                const upload = cloud.getStorage('upload', htmlFiles[0].cloudStorage)?.upload;
                if (upload && upload.endpoint) {
                    endpoint = Module.toPosix(upload.endpoint) + '/';
                }
            }
            const getFiles = (item: ExternalAsset, data: CloudStorageUpload) => {
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
                const cloudMain = cloud.getStorage('upload', item.cloudStorage);
                for (const storage of item.cloudStorage!) {
                    if (cloud.hasStorage('upload', storage)) {
                        const upload = storage.upload!;
                        if (storage === cloudMain && upload.localStorage === false) {
                            localStorage.set(item, upload);
                        }
                        let uploadHandler: UploadCallback;
                        try {
                            uploadHandler = cloud.getUploadHandler(storage.service, cloud.getCredential(storage));
                        }
                        catch (err) {
                            this.writeFail(['Upload function not supported', storage.service], err);
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
                                                    fileGroup.push([storage.service === 'gcloud' ? group[j] : fs.readFileSync(group[j]), path.extname(group[j])]);
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
                                                                filename = assignFilename(upload);
                                                            }
                                                            else if (upload.overwrite) {
                                                                filename = path.basename(fileUri);
                                                            }
                                                        }
                                                        uploadHandler({ buffer, upload, fileUri, fileGroup, bucket: storage.bucket, bucketGroup, filename, mimeType: mimeType || mime.lookup(fileUri) || undefined }, success);
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
                        if (storage.admin?.emptyBucket && cloud.hasCredential('storage', storage) && storage.bucket && !(bucketMap[storage.service] ||= new Map()).has(storage.bucket)) {
                            bucketMap[storage.service].set(storage.bucket, cloud.getCredential(storage));
                        }
                    }
                }
            }
            for (const service in bucketMap) {
                for (const [bucket, credential] of bucketMap[service]) {
                    tasks.push(cloud.deleteObjects(service, credential, bucket).catch(err => this.writeFail(['Cloud provider not found', service], err)));
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
                                        let dir = this.baseDirectory;
                                        for (const seg of path.dirname(value).substring(this.baseDirectory.length + 1).split(/[\\/]/)) {
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
                        if (cloud.hasStorage('download', data)) {
                            const { active, pathname, filename, overwrite } = data.download!;
                            if (filename) {
                                const fileUri = item.fileUri;
                                let valid = false,
                                    downloadUri = pathname ? path.join(this.baseDirectory, pathname.replace(/^([A-Z]:)?[\\/]+/i, '')) : data.admin?.preservePath && fileUri ? path.join(path.dirname(fileUri), filename) : path.join(this.baseDirectory, filename);
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
                                    const location = data.service + data.bucket + filename;
                                    if (downloadMap[location]) {
                                        downloadMap[location].add(downloadUri);
                                    }
                                    else {
                                        try {
                                            tasks.push(cloud.downloadObject(data.service, cloud.getCredential(data), data.bucket!, data.download!, (value: Null<Buffer | string>) => {
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
                                                        this.writeFail(['Write buffer', data.service], err);
                                                    }
                                                }
                                            }, bucketGroup));
                                            downloadMap[location] = new Set<string>([downloadUri]);
                                        }
                                        catch (err) {
                                            this.writeFail(['Download function not supported', data.service], err);
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
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileManager;
    module.exports.default = FileManager;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default FileManager;