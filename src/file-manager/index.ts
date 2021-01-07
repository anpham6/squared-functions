import type { DocumentConstructor, ExtendedSettings, ExternalAsset, ICloud, ICompress, IFileManager, IWatch, ImageConstructor, RequestBody, Settings, internal } from '../types/lib';
import type { CloudService } from '../types/lib/squared';
import type { Response } from 'express';

import child_process = require('child_process');
import path = require('path');
import fs = require('fs-extra');
import request = require('request');
import uuid = require('uuid');
import mime = require('mime-types');

import Module from '../module';
import Document from '../document';
import Image from '../image';
import Cloud from '../cloud';
import Watch from '../watch';

import Node from '../node';
import Compress from '../compress';

type CloudModule = ExtendedSettings.CloudModule;
type GulpModule = ExtendedSettings.GulpModule;
type DocumentModule = ExtendedSettings.DocumentModule;

type AssetData = internal.AssetData;
type FileData = internal.FileData;
type FileOutput = internal.FileOutput;
type OutputData = internal.Image.OutputData;
type DocumentInstallData = internal.Document.InstallData;
type SourceMap = internal.Document.SourceMap;
type SourceMapInput = internal.Document.SourceMapInput;
type SourceMapOutput = internal.Document.SourceMapOutput;

interface GulpData {
    gulpfile: string;
    items: string[];
}

interface GulpTask {
    task: string;
    origDir: string;
    data: GulpData;
}

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
            if (tinypng_api_key) {
                Compress.tinifyApiKey = tinypng_api_key;
            }
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
                    res.json(Node.getResponseError('OPTION: --unc-write', 'Writing to UNC shares is not enabled.'));
                }
                return false;
            }
        }
        else if (!Node.hasDiskWrite()) {
            if (res) {
                res.json(Node.getResponseError('OPTION: --disk-write', 'Writing to disk is not enabled.'));
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
                res.json(Node.getResponseError('DIRECTORY: ' + dirname, err));
            }
            return false;
        }
        return true;
    }

    public delayed = 0;
    public cleared = false;
    public Image: Null<ImageConstructor> = null;
    public Document: DocumentInstallData[] = [];
    public Cloud: Null<ICloud> = null;
    public Watch: Null<IWatch> = null;
    public Compress: Null<ICompress> = null;
    public Gulp: Null<GulpModule> = null;
    public readonly assets: ExternalAsset[];
    public readonly documentAssets: ExternalAsset[];
    public readonly files = new Set<string>();
    public readonly filesQueued = new Set<string>();
    public readonly filesToRemove = new Set<string>();
    public readonly filesToCompare = new Map<ExternalAsset, string[]>();
    public readonly contentToAppend = new Map<string, string[]>();
    public readonly postFinalize: FunctionType<void>;

    constructor(
        public readonly baseDirectory: string,
        public readonly body: RequestBody,
        postFinalize: FunctionType<void> = () => undefined)
    {
        super();
        this.assets = this.body.assets;
        this.documentAssets = this.assets.filter(item => item.document);
        this.postFinalize = postFinalize.bind(this);
    }

    install(name: string, ...args: unknown[]) {
        switch (name) {
            case 'image': {
                const ImageClass = args[0] as ImageConstructor;
                if (ImageClass.prototype instanceof Image) {
                    this.Image = ImageClass;
                }
                break;
            }
            case 'document': {
                const DocumentClass = args[0] as DocumentConstructor;
                if (DocumentClass.prototype instanceof Document) {
                    const document = new DocumentClass(this.body, args[1] as DocumentModule, ...args.slice(2));
                    DocumentClass.init.call(this, document);
                    this.Document.push({ document, instance: DocumentClass, params: args.slice(1) });
                }
                break;
            }
            case 'cloud':
                this.Cloud = new Cloud(args[0] as CloudModule, this.body.database);
                break;
            case 'watch': {
                const interval = args[0];
                const watch = new Watch(typeof interval === 'number' && interval > 0 ? interval : undefined);
                watch.whenModified = (assets: ExternalAsset[]) => {
                    const manager = new FileManager(this.baseDirectory, { ...this.body, assets });
                    for (const { instance, params } of this.Document) {
                        manager.install('document', instance, ...params);
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
                this.Watch = watch;
                break;
            }
            case 'compress':
                this.Compress = Compress;
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
    replace(file: ExternalAsset, replaceWith: string, mimeType?: string) {
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
                file.relativePath = this.getRelativePath(file);
                file.mimeType = mimeType || mime.lookup(replaceWith) || file.mimeType;
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
    setFileUri(file: ExternalAsset): FileOutput {
        this.assignFilename(file);
        const pathname = path.join(this.baseDirectory, file.moveTo || '', file.pathname);
        const fileUri = path.join(pathname, file.filename);
        file.fileUri = fileUri;
        file.relativePath = this.getRelativePath(file);
        return { pathname, fileUri };
    }
    getRelativePath(file: ExternalAsset, filename = file.filename) {
        return Node.joinPosix(file.moveTo, file.pathname, filename);
    }
    assignFilename(data: AssetData) {
        const filename = data.filename;
        if (filename) {
            return filename.startsWith('__assign__') ? data.filename = uuid.v4() + filename.substring(10) : filename;
        }
    }
    findAsset(uri: string) {
        return this.assets.find(item => item.uri === uri && !item.invalid);
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
        if (file.document) {
            for (const { document, instance } of this.Document) {
                if (file.document.includes(document.documentName)) {
                    content = await instance.formatContent.call(this, document, file, content);
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
        let output = '';
        if (file.trailingContent) {
            for (let value of file.trailingContent) {
                if (file.document) {
                    for (const { document, instance } of this.Document) {
                        if (file.document.includes(document.documentName)) {
                            value = await instance.formatContent.call(this, document, file, value);
                        }
                    }
                }
                output += '\n' + value;
            }
        }
        return output;
    }
    joinAllContent(fileUri: string) {
        const files = this.contentToAppend.get(fileUri);
        if (files) {
            return files.reduce((a, b) => b ? a + '\n' + b : a, '');
        }
    }
    createSourceMap(file: ExternalAsset, sourcesContent: string) {
        return Object.create({
            file,
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
    writeSourceMap(outputData: [string, Undef<Map<string, SourceMapOutput>>], file: ExternalAsset, sourcesContent = '', modified?: boolean) {
        const sourceMap = outputData[1];
        if (!sourceMap || sourceMap.size === 0) {
            return;
        }
        const fileUri = file.fileUri!;
        const items = Array.from(sourceMap);
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
    queueImage(data: FileData, outputType: string, saveAs: string, command = '') {
        const file = data.file;
        const fileUri = file.fileUri!;
        let output: Undef<string>;
        if (file.document) {
            for (const { document } of this.Document) {
                if (file.document.includes(document.documentName) && document.queueImage && (output = document.queueImage(data, outputType, saveAs, command))) {
                    break;
                }
            }
        }
        if (!output) {
            if (file.mimeType === outputType) {
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
                        return;
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
        }
        this.filesQueued.add(output ||= fileUri);
        return output;
    }
    async compressFile(file: ExternalAsset) {
        const { compress, fileUri } = file;
        if (compress && fileUri && this.has(fileUri)) {
            const tasks: Promise<void>[] = [];
            for (const item of compress) {
                let valid = false;
                switch (item.format) {
                    case 'gz':
                        valid = true;
                        break;
                    case 'br':
                        valid = Node.supported(11, 7);
                        break;
                    default:
                        valid = typeof Compress.compressorProxy[item.format] === 'function';
                        break;
                }
                if (valid) {
                    tasks.push(
                        new Promise<void>(resolve => Compress.tryFile(fileUri, item, null, (result: string) => {
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
    finalizeImage(data: OutputData, error?: Null<Error>) {
        const { file, command } = data;
        let output = data.output,
            parent: Undef<ExternalAsset>;
        if (file.document) {
            data.baseDirectory = this.baseDirectory;
            for (const { document } of this.Document) {
                if (file.document.includes(document.documentName) && document.finalizeImage && document.finalizeImage(data, error)) {
                    if (error || !output) {
                        this.completeAsyncTask();
                        return;
                    }
                    parent = file;
                    break;
                }
            }
        }
        if (!error && output) {
            const original = file.fileUri === output;
            if (!parent && !original) {
                if (command.includes('%')) {
                    if (this.filesToCompare.has(file)) {
                        this.filesToCompare.get(file)!.push(output);
                    }
                    else {
                        this.filesToCompare.set(file, [output]);
                    }
                    output = '';
                }
                else if (command.includes('@')) {
                    this.replace(file, output);
                    output = '';
                }
                else {
                    parent = file;
                }
            }
            this.completeAsyncTask(output, !original ? parent : undefined);
        }
        else {
            this.writeFail(['Unable to finalize image', path.basename(output)], error);
            this.completeAsyncTask();
        }
    }
    async finalizeAsset(data: FileData, parent?: ExternalAsset) {
        const file = data.file;
        const fileUri = file.fileUri!;
        if (this.Image) {
            const mimeType = file.mimeType || mime.lookup(fileUri);
            if (mimeType && mimeType.startsWith('image/')) {
                let valid = true;
                if (file.mimeType === 'image/unknown') {
                    try {
                        valid = await this.Image.resolveMime.call(this, data);
                    }
                    catch (err) {
                        this.writeFail(['Unable to read image buffer', path.basename(fileUri)], err);
                        valid = false;
                    }
                    if (!valid) {
                        file.invalid = true;
                    }
                }
                else {
                    data.mimeType = mimeType;
                }
                if (valid && file.commands) {
                    const callback = this.finalizeImage.bind(this);
                    for (const command of file.commands) {
                        if (Compress.withinSizeRange(fileUri, command)) {
                            this.Image.using.call(this, data, command, callback);
                        }
                    }
                }
            }
        }
        if (file.document) {
            for (const { document, instance } of this.Document) {
                if (file.document.includes(document.documentName)) {
                    await instance.using.call(this, document, file);
                }
            }
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
            this.completeAsyncTask(fileUri, parent);
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
                    this.finalizeAsset({ file });
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
                        bundleMain = file;
                    }
                    else {
                        content = await this.getTrailingContent(file);
                        if (content) {
                            file.sourceUTF8 = content;
                            bundleMain = file;
                        }
                        else {
                            delete file.sourceUTF8;
                            file.bundleIndex = Infinity;
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
                    this.finalizeAsset({ file: bundleMain || file });
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
                        this.finalizeAsset({ file: item });
                    }
                }
                delete processing[fileUri];
            }
            else {
                this.finalizeAsset({ file });
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
            if (!file.pathname && !file.filename) {
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
                        this.finalizeAsset({ file });
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
        const emptyDir = new Set<string>();
        let tasks: Promise<unknown>[] = [],
            compressMap: Undef<WeakSet<ExternalAsset>>;
        const parseDirectory = (value: string) => {
            let dir = this.baseDirectory;
            for (const seg of path.dirname(value).substring(this.baseDirectory.length + 1).split(/[\\/]/)) {
                if (seg) {
                    dir += path.sep + seg;
                    emptyDir.add(dir);
                }
            }
        };
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
        if (this.documentAssets.length) {
            for (const { document, instance } of this.Document) {
                const assets = this.documentAssets.filter(item => item.document!.includes(document.documentName));
                if (assets.length) {
                    await instance.finalize.call(this, document, assets);
                }
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
                    .then(() => {
                        parseDirectory(value);
                        this.delete(value);
                    })
                    .catch(err => {
                        if (err.code !== 'ENOENT') {
                            throw err;
                        }
                    })
            );
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => this.writeFail(['Delete temporary files', 'finalize'], err));
            tasks = [];
        }
        if (this.Compress) {
            for (const item of this.assets) {
                if (item.compress && !item.invalid) {
                    const fileUri = item.fileUri!;
                    const mimeType = mime.lookup(fileUri) || item.mimeType;
                    if (mimeType && mimeType.startsWith('image/')) {
                        const image = Compress.findFormat(item.compress, mimeType.split('/')[1]);
                        if (image && Compress.withinSizeRange(fileUri, image.condition)) {
                            tasks.push(new Promise(resolve => {
                                try {
                                    Compress.tryImage(fileUri, image, resolve);
                                }
                                catch (err) {
                                    this.writeFail(['Unable to compress image', path.basename(fileUri)], err);
                                    resolve(false);
                                }
                            }));
                        }
                    }
                }
            }
            if (tasks.length) {
                await Promise.all(tasks).catch(err => this.writeFail(['Unable to compress images', 'finalize'], err));
                tasks = [];
            }
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
                const tempDir = this.getTempDir(true);
                try {
                    fs.mkdirpSync(tempDir);
                    Promise.all(data.items.map(uri => fs.copyFile(uri, path.join(tempDir, path.basename(uri)))))
                        .then(() => {
                            this.formatMessage(this.logType.PROCESS, 'gulp', ['Executing task...', task], data.gulpfile);
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
                                                            this.writeFail(['Unable to replace original files', 'gulp: ' + task], err_w);
                                                            callback();
                                                        });
                                                }
                                                else {
                                                    callback();
                                                }
                                            });
                                        })
                                        .catch(error => this.writeFail(['Unable to delete original files', 'gulp: ' + task], error));
                                }
                                else {
                                    this.writeFail(['Unknown', 'gulp: ' + task], err);
                                    callback();
                                }
                            });
                        })
                        .catch(err => this.writeFail(['Unable to copy original files', 'gulp: ' + task], err));
                }
                catch (err) {
                    this.writeFail(['Unknown', 'gulp: ' + task], err);
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
        if (this.Cloud) {
            const { deleted, compressed } = await Cloud.finalize.call(this, this.Cloud);
            deleted.forEach(value => parseDirectory(value));
            compressMap = compressed;
        }
        if (this.Compress) {
            for (const item of this.assets) {
                if (item.compress && (!compressMap || !compressMap.has(item)) && !item.invalid) {
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
        for (const value of Array.from(emptyDir).reverse()) {
            try {
                fs.rmdirSync(value);
            }
            catch {
            }
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileManager;
    module.exports.default = FileManager;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default FileManager;