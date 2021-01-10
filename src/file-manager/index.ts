import type { DocumentConstructor, ExtendedSettings, ExternalAsset, ICloud, ICompress, IDocument, IFileManager, ITask, IWatch, ImageConstructor, Internal, RequestBody, Settings, TaskConstructor } from '../types/lib';
import type { CloudService } from '../types/lib/squared';
import type { Response } from 'express';

import path = require('path');
import fs = require('fs-extra');
import request = require('request');
import uuid = require('uuid');
import mime = require('mime-types');

import Module from '../module';
import Document from '../document';
import Task from '../task';
import Image from '../image';
import Cloud from '../cloud';
import Watch from '../watch';

import Node from '../node';
import Compress from '../compress';

type CloudModule = ExtendedSettings.CloudModule;
type DocumentModule = ExtendedSettings.DocumentModule;

type DocumentData = Internal.DocumentData;
type FileData = Internal.FileData;
type FileOutput = Internal.FileOutput;
type OutputData = Internal.Image.OutputData;
type DocumentInstallData = Internal.InstallData<IDocument, DocumentConstructor>;
type TaskInstallData = Internal.InstallData<ITask, TaskConstructor>;
type SourceMap = Internal.Document.SourceMap;
type SourceMapInput = Internal.Document.SourceMapInput;
type SourceMapOutput = Internal.Document.SourceMapOutput;

const isObject = <T = PlainObject>(value: unknown): value is T => typeof value === 'object' && value !== null;
const isFunction = <T>(value: unknown): value is T => typeof value === 'function';
const hasDocument = (document: string | string[], documentName: string) => Array.isArray(document) && document.includes(documentName) || document === documentName;

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
            const gzip = parseInt(gzip_level as string);
            const brotli = parseInt(brotli_quality as string);
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
    public Task: TaskInstallData[] = [];
    public Cloud: Null<ICloud> = null;
    public Watch: Null<IWatch> = null;
    public Compress: Null<ICompress> = null;
    public readonly assets: ExternalAsset[];
    public readonly documentAssets: ExternalAsset[] = [];
    public readonly taskAssets: ExternalAsset[] = [];
    public readonly files = new Set<string>();
    public readonly filesQueued = new Set<string>();
    public readonly filesToRemove = new Set<string>();
    public readonly filesToCompare = new Map<ExternalAsset, string[]>();
    public readonly contentToAppend = new Map<string, string[]>();
    public readonly emptyDir = new Set<string>();
    public readonly postFinalize: FunctionType<void>;

    constructor(
        public readonly baseDirectory: string,
        public readonly body: RequestBody,
        postFinalize: FunctionType<void> = () => undefined)
    {
        super();
        this.assets = this.body.assets;
        for (const item of this.assets) {
            if (item.document) {
                this.documentAssets.push(item);
            }
            if (item.tasks) {
                this.taskAssets.push(item);
            }
        }
        this.postFinalize = postFinalize.bind(this);
    }

    install(name: string, ...args: unknown[]) {
        const target = args[0];
        const params = args.slice(1);
        switch (name) {
            case 'document':
                if (isFunction<DocumentConstructor>(target) && target.prototype instanceof Document) {
                    const instance = new target(this.body, args[1] as DocumentModule, ...args.slice(2));
                    target.init.call(this, instance);
                    this.Document.push({ instance, constructor: target, params });
                }
                break;
            case 'task':
                if (isFunction<TaskConstructor>(target) && target.prototype instanceof Task && isObject(args[1])) {
                    const instance = new target(args[1]);
                    this.Task.push({ instance, constructor: target, params });
                }
                break;
            case 'image':
                if (isFunction<ImageConstructor>(target) && target.prototype instanceof Image) {
                    this.Image = target;
                }
                break;
            case 'cloud':
                if (isObject<CloudModule>(target)) {
                    this.Cloud = new Cloud(target, this.body.database);
                }
                break;
            case 'watch': {
                const watch = new Watch(typeof target === 'number' && target > 0 ? target : undefined);
                watch.whenModified = (assets: ExternalAsset[]) => {
                    const manager = new FileManager(this.baseDirectory, { ...this.body, assets });
                    for (const { constructor, params } of this.Document) { // eslint-disable-line no-shadow
                        manager.install('document', constructor, ...params);
                    }
                    for (const { constructor, params } of this.Task) { // eslint-disable-line no-shadow
                        manager.install('task', constructor, ...params);
                    }
                    if (this.Cloud) {
                        manager.install('cloud', this.Cloud.settings);
                    }
                    if (this.Compress) {
                        manager.install('compress', this.Compress);
                    }
                    manager.processAssets();
                };
                this.Watch = watch;
                break;
            }
            case 'compress':
                this.Compress = Compress;
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
    delete(value: string, emptyDir = true) {
        this.files.delete(this.removeCwd(value));
        if (emptyDir) {
            let dir = this.baseDirectory;
            for (const seg of path.dirname(value).substring(this.baseDirectory.length + 1).split(/[\\/]/)) {
                if (seg) {
                    dir += path.sep + seg;
                    this.emptyDir.add(dir);
                }
            }
        }
    }
    has(value: Undef<string>): value is string {
        return value ? this.files.has(this.removeCwd(value)) : false;
    }
    replace(file: ExternalAsset, replaceWith: string, mimeType?: string) {
        const localUri = file.localUri;
        if (localUri) {
            if (replaceWith.includes('__copy__') && path.extname(localUri) === path.extname(replaceWith)) {
                try {
                    fs.renameSync(replaceWith, localUri);
                }
                catch (err) {
                    this.writeFail(['Unable to rename file', path.basename(replaceWith)], err);
                }
            }
            else {
                file.originalName ||= file.filename;
                file.filename = path.basename(replaceWith);
                file.localUri = this.setLocalUri(file).localUri;
                file.relativeUri = this.getRelativeUri(file);
                file.mimeType = mimeType || mime.lookup(replaceWith) || file.mimeType;
                this.filesToRemove.add(localUri);
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
    completeAsyncTask(localUri?: string, parent?: ExternalAsset) {
        if (this.delayed !== Infinity) {
            if (localUri) {
                this.add(localUri, parent);
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
    setLocalUri(file: ExternalAsset): FileOutput {
        file.pathname = Module.toPosix(file.pathname);
        this.assignUUID(file, 'pathname');
        this.assignUUID(file, 'filename');
        const segments = [this.baseDirectory, file.moveTo, file.pathname].filter(value => value) as string[];
        const pathname = segments.length > 1 ? path.join(...segments) : this.baseDirectory;
        const localUri = path.join(pathname, file.filename);
        file.localUri = localUri;
        file.relativeUri = this.getRelativeUri(file);
        return { pathname, localUri };
    }
    getRelativeUri(file: ExternalAsset, filename = file.filename) {
        return Node.joinPosix(file.moveTo, file.pathname, filename);
    }
    assignUUID(data: DocumentData, attr: string, target: any = data) {
        const document = data.document;
        if (document) {
            const value: unknown = data[attr];
            if (typeof value === 'string') {
                for (const { instance } of this.Document) {
                    if (hasDocument(document, instance.documentName) && value.includes(instance.internalAssignUUID)) {
                        return target[attr] = value.replace(instance.internalAssignUUID, uuid.v4());
                    }
                }
                return value;
            }
        }
    }
    findAsset(uri: string) {
        return this.assets.find(item => item.uri === uri && !item.invalid);
    }
    removeCwd(value: Undef<string>) {
        return value ? value.substring(this.baseDirectory.length + 1) : '';
    }
    getUTF8String(file: ExternalAsset, localUri?: string) {
        if (!file.sourceUTF8) {
            if (file.buffer) {
                file.sourceUTF8 = file.buffer.toString('utf8');
            }
            if (localUri ||= file.localUri) {
                try {
                    file.sourceUTF8 = fs.readFileSync(localUri, 'utf8');
                }
                catch (err) {
                    this.writeFail(['File not found', path.basename(localUri)], err);
                }
            }
        }
        return file.sourceUTF8 || '';
    }
    async appendContent(file: ExternalAsset, localUri: string, content: string, bundleIndex = 0) {
        if (file.document) {
            for (const { instance } of this.Document) {
                if (hasDocument(file.document, instance.documentName) && instance.formatContent) {
                    content = await instance.formatContent(this, instance, file, content);
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
        const items = this.contentToAppend.get(localUri) || [];
        items[bundleIndex - 1] = content;
        this.contentToAppend.set(localUri, items);
        return '';
    }
    async getTrailingContent(file: ExternalAsset) {
        let output = '';
        if (file.trailingContent) {
            for (let value of file.trailingContent) {
                if (file.document) {
                    for (const { instance } of this.Document) {
                        if (hasDocument(file.document, instance.documentName) && instance.formatContent) {
                            value = await instance.formatContent(this, instance, file, value);
                        }
                    }
                }
                output += '\n' + value;
            }
        }
        return output;
    }
    joinAllContent(localUri: string) {
        const files = this.contentToAppend.get(localUri);
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
        const localUri = file.localUri!;
        const items = Array.from(sourceMap);
        const excludeSources = items.some(data => data[1].sourcesContent === null);
        const [name, data] = items.pop()!;
        const filename = path.basename(localUri);
        const map = data.map;
        const mapFile = filename + '.map';
        map.file = filename;
        if (map.sourceRoot && file.bundleRoot && !modified) {
            const bundleRoot = file.bundleRoot;
            map.sources = this.assets.filter(item => item.bundleId && item.bundleId === file.bundleId).sort((a, b) => a.bundleIndex! - b.bundleIndex!).map(item => item.uri!.replace(bundleRoot, ''));
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
            const mapUri = path.join(path.dirname(localUri), mapFile);
            fs.writeFileSync(mapUri, JSON.stringify(map), 'utf8');
            this.add(mapUri, file);
        }
        catch (err) {
            this.writeFail(['Unable to generate source map', name], err);
        }
    }
    queueImage(data: FileData, outputType: string, saveAs: string, command = '') {
        const file = data.file;
        const localUri = file.localUri!;
        let output: Undef<string>;
        if (file.document) {
            for (const { instance } of this.Document) {
                if (hasDocument(file.document, instance.documentName) && instance.imageQueue && (output = instance.imageQueue(data, outputType, saveAs, command))) {
                    break;
                }
            }
        }
        if (!output) {
            if (file.mimeType === outputType) {
                if (!command.includes('@') || this.filesQueued.has(localUri)) {
                    let i = 1;
                    do {
                        output = Module.renameExt(localUri, '__copy__.' + (i > 1 ? `(${i}).` : '') + saveAs);
                    }
                    while (this.filesQueued.has(output) && ++i);
                    try {
                        fs.copyFileSync(localUri, output);
                    }
                    catch (err) {
                        this.writeFail(['Unable to copy file', path.basename(localUri)], err);
                        return;
                    }
                }
            }
            else {
                let i = 1;
                do {
                    output = Module.renameExt(localUri, (i > 1 ? `(${i}).` : '') + saveAs);
                }
                while (this.filesQueued.has(output) && ++i);
            }
        }
        this.filesQueued.add(output ||= localUri);
        return output;
    }
    async compressFile(file: ExternalAsset) {
        const { compress, localUri } = file;
        if (compress && this.has(localUri)) {
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
                        new Promise<void>(resolve => Compress.tryFile(localUri, item, null, (result: string) => {
                            if (result) {
                                this.add(result, file);
                            }
                            resolve();
                        }))
                    );
                }
            }
            if (tasks.length) {
                return Promise.all(tasks).catch(err => this.writeFail(['Compress', path.basename(localUri)], err));
            }
        }
    }
    finalizeImage(data: OutputData, error?: Null<Error>) {
        const { file, command } = data;
        let output = data.output,
            parent: Undef<ExternalAsset>;
        if (file.document) {
            data.baseDirectory = this.baseDirectory;
            for (const { instance } of this.Document) {
                if (hasDocument(file.document, instance.documentName) && instance.imageFinalize && instance.imageFinalize(data, error)) {
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
            const original = file.localUri === output;
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
        const localUri = file.localUri!;
        if (this.Image) {
            const mimeType = file.mimeType || mime.lookup(localUri);
            if (mimeType && mimeType.startsWith('image/')) {
                let valid = true;
                if (file.mimeType === 'image/unknown') {
                    try {
                        valid = await this.Image.resolveMime.call(this, data);
                    }
                    catch (err) {
                        this.writeFail(['Unable to read image buffer', path.basename(localUri)], err);
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
                        if (Compress.withinSizeRange(localUri, command)) {
                            this.Image.using.call(this, data, command, callback);
                        }
                    }
                }
            }
        }
        if (file.document) {
            for (const { instance, constructor } of this.Document) {
                if (hasDocument(file.document, instance.documentName)) {
                    await constructor.using.call(this, instance, file);
                }
            }
        }
        if (file.invalid) {
            if (!file.bundleId) {
                try {
                    fs.unlinkSync(localUri);
                }
                catch (err) {
                    this.writeFail(['Unable to delete file', path.basename(localUri)], err);
                }
            }
            this.completeAsyncTask('');
        }
        else {
            this.completeAsyncTask(localUri, parent);
        }
    }
    processAssets(emptyDirectory?: boolean) {
        const emptyDir = new Set<string>();
        const notFound: ObjectMap<boolean> = {};
        const processing: ObjectMap<ExternalAsset[]> = {};
        const appending: ObjectMap<ExternalAsset[]> = {};
        const completed: string[] = [];
        const checkQueue = (file: ExternalAsset, localUri: string, content?: boolean) => {
            const bundleIndex = file.bundleIndex;
            if (bundleIndex !== undefined && bundleIndex !== -1) {
                appending[localUri] ||= [];
                if (bundleIndex > 0) {
                    appending[localUri][bundleIndex - 1] = file;
                    return true;
                }
            }
            else if (!content) {
                if (completed.includes(localUri)) {
                    this.finalizeAsset({ file });
                    return true;
                }
                const queue = processing[localUri];
                if (queue) {
                    this.performAsyncTask();
                    queue.push(file);
                    return true;
                }
                processing[localUri] = [file];
            }
            return false;
        };
        const processQueue = async (file: ExternalAsset, localUri: string, bundleMain?: ExternalAsset) => {
            if (file.bundleIndex !== undefined) {
                let cloudStorage: Undef<CloudService[]>;
                if (file.bundleIndex === 0) {
                    let content = this.getUTF8String(file, localUri);
                    if (content) {
                        content = await this.appendContent(file, localUri, content);
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
                const items = appending[localUri];
                if (items) {
                    let queue: Undef<ExternalAsset>;
                    while (!queue && items.length) {
                        queue = items.shift();
                    }
                    if (queue) {
                        const verifyBundle = async (next: ExternalAsset, value: string) => {
                            if (bundleMain) {
                                return this.appendContent(next, localUri, value, next.bundleIndex);
                            }
                            if (value) {
                                next.sourceUTF8 = await this.appendContent(next, localUri, value) || value;
                                next.cloudStorage = cloudStorage;
                                bundleMain = queue;
                            }
                            else {
                                next.invalid = true;
                            }
                        };
                        const resumeQueue = () => processQueue(queue!, localUri, bundleMain);
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
                delete appending[localUri];
            }
            else if (Array.isArray(processing[localUri])) {
                completed.push(localUri);
                for (const item of processing[localUri]) {
                    if (!item.invalid) {
                        this.finalizeAsset({ file: item });
                    }
                }
                delete processing[localUri];
            }
            else {
                this.finalizeAsset({ file });
            }
        };
        const errorRequest = (file: ExternalAsset, localUri: string, err: Error | string, stream?: fs.WriteStream) => {
            const uri = file.uri!;
            if (!notFound[uri]) {
                if (appending[localUri]) {
                    processQueue(file, localUri);
                }
                else {
                    this.completeAsyncTask();
                }
                notFound[uri] = true;
            }
            if (stream) {
                try {
                    stream.close();
                    fs.unlink(localUri);
                }
                catch {
                }
            }
            this.writeFail(['Unable to download file', uri], err);
            file.invalid = true;
            delete processing[localUri];
        };
        for (const item of this.assets) {
            if (!item.filename) {
                item.invalid = true;
                continue;
            }
            const { pathname, localUri } = this.setLocalUri(item);
            const fileReceived = (err: NodeJS.ErrnoException) => {
                if (err) {
                    item.invalid = true;
                }
                if (!err || appending[localUri]) {
                    processQueue(item, localUri);
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
                    item.invalid = true;
                }
                emptyDir.add(pathname);
            }
            if (item.content) {
                if (!checkQueue(item, localUri, true)) {
                    item.sourceUTF8 = item.content;
                    this.performAsyncTask();
                    fs.writeFile(localUri, item.content, 'utf8', err => fileReceived(err));
                }
            }
            else if (item.base64) {
                this.performAsyncTask();
                fs.writeFile(localUri, item.base64, 'base64', err => {
                    if (!err) {
                        this.finalizeAsset({ file: item });
                    }
                    else {
                        item.invalid = true;
                        this.completeAsyncTask();
                    }
                });
            }
            else {
                const uri = item.uri;
                if (!uri || notFound[uri]) {
                    item.invalid = true;
                    continue;
                }
                try {
                    if (Node.isFileURI(uri)) {
                        if (!checkQueue(item, localUri)) {
                            const stream = fs.createWriteStream(localUri);
                            stream.on('finish', () => {
                                if (!notFound[uri]) {
                                    processQueue(item, localUri);
                                }
                            });
                            this.performAsyncTask();
                            request(uri)
                                .on('response', response => {
                                    if (this.Watch) {
                                        item.etag = (response.headers['etag'] || response.headers['last-modified']) as string;
                                    }
                                    const statusCode = response.statusCode;
                                    if (statusCode >= 300) {
                                        errorRequest(item, localUri, statusCode + ' ' + response.statusMessage, stream);
                                    }
                                })
                                .on('data', data => {
                                    if (Buffer.isBuffer(data)) {
                                        item.buffer = item.buffer ? Buffer.concat([item.buffer, data]) : data;
                                    }
                                })
                                .on('error', err => errorRequest(item, localUri, err, stream))
                                .pipe(stream);
                            }
                    }
                    else if (Node.hasUNCRead() && Node.isFileUNC(uri) || Node.hasDiskRead() && path.isAbsolute(uri)) {
                        if (!checkQueue(item, localUri)) {
                            this.performAsyncTask();
                            fs.copyFile(uri, localUri, err => fileReceived(err));
                        }
                    }
                    else {
                        item.invalid = true;
                    }
                }
                catch (err) {
                    errorRequest(item, localUri, err);
                }
            }
        }
        this.cleared = true;
        this.performFinalize();
    }
    async finalize() {
        const compressMap = new WeakSet<ExternalAsset>();
        let tasks: Promise<unknown>[] = [];
        for (const [file, output] of this.filesToCompare) {
            const localUri = file.localUri!;
            let minFile = localUri,
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
            if (minFile !== localUri) {
                this.replace(file, minFile);
            }
        }
        if (this.documentAssets.length) {
            for (const { instance, constructor } of this.Document) {
                const assets = this.documentAssets.filter(item => item.document!.includes(instance.documentName) && !item.invalid);
                if (assets.length) {
                    await constructor.finalize.call(this, instance, assets);
                }
            }
        }
        for (const item of this.assets) {
            if (item.sourceUTF8 && !item.invalid) {
                tasks.push(fs.writeFile(item.localUri!, item.sourceUTF8, 'utf8'));
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
            await Promise.all(tasks).catch(err => this.writeFail(['Delete temporary files', 'finalize'], err));
            tasks = [];
        }
        if (this.Compress) {
            for (const item of this.assets) {
                if (item.compress && !item.invalid) {
                    const localUri = item.localUri!;
                    const mimeType = mime.lookup(localUri) || item.mimeType;
                    if (mimeType && mimeType.startsWith('image/')) {
                        const image = Compress.findFormat(item.compress, mimeType.split('/')[1]);
                        if (image && Compress.withinSizeRange(localUri, image.condition)) {
                            tasks.push(new Promise(resolve => {
                                try {
                                    Compress.tryImage(localUri, image, resolve);
                                }
                                catch (err) {
                                    this.writeFail(['Unable to compress image', path.basename(localUri)], err);
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
        if (this.taskAssets.length) {
            for (const { instance, constructor } of this.Task) {
                const assets = this.taskAssets.filter(item => item.tasks!.find(data => data.handler === instance.taskName && item.localUri && !item.invalid));
                if (assets.length) {
                    await constructor.finalize.call(this, instance, assets);
                }
            }
        }
        if (this.Cloud) {
            const { compressed } = await Cloud.finalize.call(this, this.Cloud);
            for (const item of compressed) {
                compressMap.add(item);
            }
        }
        if (this.Compress) {
            for (const item of this.assets) {
                if (item.compress && !compressMap.has(item) && !item.invalid) {
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
        for (const value of Array.from(this.emptyDir).reverse()) {
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