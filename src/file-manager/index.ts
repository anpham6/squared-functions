import type { DataSource, ElementAction, FileInfo, XmlTagNode } from '../types/lib/squared';

import type { DocumentConstructor, ICloud, ICompress, IDocument, IFileManager, IModule, ITask, IWatch, ImageConstructor, TaskConstructor } from '../types/lib';
import type { ExternalAsset, FileData, FileOutput, OutputData } from '../types/lib/asset';
import type { CloudDatabase, CloudService } from '../types/lib/cloud';
import type { InstallData, PostFinalizeCallback } from '../types/lib/filemanager';
import type { CloudModule, DocumentModule } from '../types/lib/module';
import type { RequestBody } from '../types/lib/node';

import path = require('path');
import fs = require('fs-extra');
import request = require('request');
import mime = require('mime-types');
import filesize = require('filesize');
import filetype = require('file-type');

import Module from '../module';
import Document from '../document';
import Task from '../task';
import Image from '../image';
import Cloud from '../cloud';
import Watch from '../watch';
import Permission from './permission';

import Compress from '../compress';

function parseSizeRange(value: string) {
    const match = /\(\s*(\d+)\s*(?:,\s*(\d+|\*)\s*)?\)/.exec(value);
    return match ? [+match[1], !match[2] || match[2] === '*' ? Infinity : +match[2]] : [0, Infinity];
}

function withinSizeRange(uri: string, value: Undef<string>) {
    if (value) {
        const [minSize, maxSize] = parseSizeRange(value);
        if (minSize > 0 || maxSize < Infinity) {
            const fileSize = Module.getFileSize(uri);
            if (fileSize === 0 || fileSize < minSize || fileSize > maxSize) {
                return false;
            }
        }
    }
    return true;
}

const concatString = (values: Undef<string[]>) => Array.isArray(values) ? values.reduce((a, b) => a + '\n' + b, '') : '';
const isFunction = <T>(value: unknown): value is T => typeof value === 'function';

class FileManager extends Module implements IFileManager {
    static moduleCompress() {
        return Compress;
    }

    static createPermission() {
        return new Permission();
    }

    static resolveMime(data: Buffer | string) {
        return data instanceof Buffer ? filetype.fromBuffer(data) : filetype.fromFile(data);
    }

    static formatSize(value: number, options?: PlainObject) {
        return filesize(value, options);
    }

    delayed = 0;
    cacheHttpRequest = false;
    permission = new Permission();
    Document: InstallData<IDocument, DocumentConstructor>[] = [];
    Task: InstallData<ITask, TaskConstructor>[] = [];
    Image: Null<Map<string, ImageConstructor>> = null;
    Cloud: Null<ICloud> = null;
    Watch: Null<IWatch> = null;
    Compress: Null<ICompress> = null;
    readonly startTime = Date.now();
    readonly assets: ExternalAsset[];
    readonly documentAssets: ExternalAsset[] = [];
    readonly taskAssets: ExternalAsset[] = [];
    readonly dataSourceItems: DataSource[] = [];
    readonly files = new Set<string>();
    readonly filesQueued = new Set<string>();
    readonly filesToRemove = new Set<string>();
    readonly filesToCompare = new Map<ExternalAsset, string[]>();
    readonly contentToAppend = new Map<string, string[]>();
    readonly contentToReplace = new Map<string, string[]>();
    readonly emptyDir = new Set<string>();
    readonly postFinalize: Null<PostFinalizeCallback> = null;

    private _cleared = false;

    constructor(
        readonly baseDirectory: string,
        readonly body: RequestBody,
        postFinalize?: PostFinalizeCallback,
        readonly archiving = false)
    {
        super();
        this.assets = this.body.assets;
        this.formatMessage(this.logType.NODE, 'START', [new Date().toLocaleString(), this.assets.length + ' assets'], this.baseDirectory, { titleBgColor: 'bgYellow', titleColor: 'black' });
        for (const item of this.assets) {
            if (item.document) {
                this.documentAssets.push(item);
            }
            if (item.tasks) {
                this.taskAssets.push(item);
            }
        }
        if (Array.isArray(this.body.dataSource)) {
            this.dataSourceItems.push(...this.body.dataSource);
        }
        if (postFinalize) {
            this.postFinalize = postFinalize.bind(this);
        }
    }

    install(name: string, ...params: unknown[]): Undef<IModule> {
        const target = params.shift();
        switch (name) {
            case 'document':
                if (isFunction<DocumentConstructor>(target) && target.prototype instanceof Document) {
                    const instance = new target(params[0] as DocumentModule, ...params.slice(1));
                    instance.host = this;
                    instance.init(this.getDocumentAssets(instance), this.body);
                    this.Document.push({ instance, constructor: target, params });
                    return instance;
                }
                break;
            case 'task':
                if (isFunction<TaskConstructor>(target) && target.prototype instanceof Task && Module.isObject(params[0])) {
                    const instance = new target(params[0], ...params.slice(1));
                    this.Task.push({ instance, constructor: target, params });
                    return instance;
                }
                break;
            case 'cloud':
                if (Module.isObject<CloudModule>(target)) {
                    return this.Cloud = new Cloud(target, this.dataSourceItems.filter(item => item.source === 'cloud') as Undef<CloudDatabase[]>);
                }
                break;
            case 'watch': {
                const [port, securePort] = params;
                const instance = new Watch(typeof target === 'number' && target > 0 ? target : undefined, typeof port === 'number' && port > 0 ? port : undefined, typeof securePort === 'number' && securePort > 0 ? securePort : undefined);
                instance.whenModified = (assets: ExternalAsset[], postFinalize?: PostFinalizeCallback) => {
                    const manager = new FileManager(this.baseDirectory, { ...this.body, assets }, postFinalize);
                    for (const { constructor, params } of this.Document) { // eslint-disable-line no-shadow
                        manager.install('document', constructor, ...params);
                    }
                    for (const { constructor, params } of this.Task) { // eslint-disable-line no-shadow
                        manager.install('task', constructor, ...params);
                    }
                    if (this.Cloud) {
                        manager.install('cloud', this.Cloud.settings);
                    }
                    if (this.Image) {
                        manager.install('image', this.Image);
                    }
                    if (this.Compress) {
                        manager.install('compress', this.Compress);
                    }
                    manager.permission = this.permission;
                    manager.cacheHttpRequest = this.cacheHttpRequest;
                    manager.processAssets();
                };
                return this.Watch = instance;
            }
            case 'image':
                if (target instanceof Map) {
                    for (const [mimeType, item] of target) {
                        if (!(item.prototype instanceof Image)) {
                            target.delete(mimeType);
                        }
                    }
                    if (target.size) {
                        this.Image = target;
                    }
                }
                break;
            case 'compress':
                return this.Compress = Compress;
        }
    }
    add(value: string, parent?: ExternalAsset) {
        if (value) {
            this.files.add(this.removeCwd(value));
            if (parent) {
                const transforms = parent.transforms ||= [];
                if (!transforms.includes(value)) {
                    transforms.push(value);
                }
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
    removeAsset(file: ExternalAsset) {
        this.filesToRemove.add(file.localUri!);
        file.invalid = true;
    }
    has(value: Undef<string>): value is string {
        return !!value && this.files.has(this.removeCwd(value));
    }
    replace(file: ExternalAsset, replaceWith: string, mimeType?: string) {
        const localUri = file.localUri;
        if (localUri) {
            if (replaceWith.indexOf('__copy__') !== -1 && path.extname(localUri) === path.extname(replaceWith)) {
                try {
                    fs.renameSync(replaceWith, localUri);
                }
                catch (err) {
                    this.writeFail(['Unable to rename file', path.basename(replaceWith)], err, this.logType.FILE);
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
    completeAsyncTask(err: Null<Error> = null, localUri = '', parent?: ExternalAsset) {
        if (this.delayed !== Infinity) {
            if (!err && localUri) {
                this.add(localUri, parent);
            }
            this.removeAsyncTask();
            this.performFinalize();
        }
        if (err) {
            this.writeFail(['Unknown', path.basename(localUri)], err, this.logType.FILE);
        }
    }
    performFinalize() {
        if (this.cleared && this.delayed <= 0) {
            this.delayed = Infinity;
            this.finalize().then(() => {
                this.writeTimeElapsed('END', this.baseDirectory, this.startTime, { titleBgColor: 'bgYellow', titleColor: 'black' });
                const files = Array.from(this.files).sort((a, b) => {
                    if (a.indexOf(path.sep) !== -1 && b.indexOf(path.sep) === -1) {
                        return -1;
                    }
                    else if (a.indexOf(path.sep) === -1 && b.indexOf(path.sep) !== -1) {
                        return 1;
                    }
                    return a < b ? -1 : 1;
                });
                if (this.postFinalize) {
                    const addErrors = (list: string[]) => {
                        if (list.length) {
                            this.errors.push(...list);
                            list.length = 0;
                        }
                    };
                    for (const { instance } of this.Document) {
                        addErrors(instance.errors);
                    }
                    for (const { instance } of this.Task) {
                        addErrors(instance.errors);
                    }
                    if (this.Cloud) {
                        addErrors(this.Cloud.errors);
                    }
                    if (this.Watch) {
                        addErrors(this.Watch.errors);
                    }
                    this.postFinalize(files.map(name => ({ name, size: filesize(Module.getFileSize(path.join(this.baseDirectory, name))) } as FileInfo)), this.errors);
                }
                this.errors.length = 0;
            });
        }
    }
    hasDocument(instance: IModule, document: Undef<StringOfArray>) {
        const moduleName = instance.moduleName;
        return !!moduleName && (document === moduleName || Array.isArray(document) && document.includes(moduleName));
    }
    setLocalUri(file: ExternalAsset) {
        const uri = file.uri;
        if (uri) {
            file.uri = Module.resolveUri(uri);
            if (!file.uri) {
                file.invalid = true;
                this.writeFail(['Unable to parse file:// protocol', uri], new Error('Path not absolute'));
            }
        }
        const segments: string[] = [];
        if (file.moveTo) {
            segments.push(file.moveTo);
        }
        if (file.pathname) {
            segments.push(file.pathname);
            file.pathname = Module.toPosix(file.pathname);
        }
        if (file.document) {
            for (const { instance } of this.Document) {
                if (instance.setLocalUri && this.hasDocument(instance, file.document)) {
                    instance.setLocalUri(file);
                }
            }
        }
        const pathname = segments.length ? path.join(this.baseDirectory, ...segments) : this.baseDirectory;
        const localUri = path.join(pathname, file.filename);
        file.localUri = localUri;
        file.relativeUri = this.getRelativeUri(file);
        file.mimeType ||= mime.lookup(uri && uri.split('?')[0] || file.filename) || '';
        return { pathname, localUri } as FileOutput;
    }
    getLocalUri(data: FileData) {
        return data.file.localUri || '';
    }
    getMimeType(data: FileData) {
        return data.mimeType ||= mime.lookup(this.getLocalUri(data)) || data.file.mimeType;
    }
    getRelativeUri(file: ExternalAsset, filename = file.filename) {
        return Module.joinPath(file.moveTo, file.pathname, filename);
    }
    getDocumentAssets(instance: IModule) {
        return this.documentAssets.filter(item => this.hasDocument(instance, item.document));
    }
    getDataSourceItems(instance: IModule) {
        return this.dataSourceItems.filter(item => this.hasDocument(instance, item.document));
    }
    getElements() {
        const result: XmlTagNode[] = [];
        for (const item of (this.documentAssets as ElementAction[]).concat(this.dataSourceItems as ElementAction[])) {
            if (item.element) {
                result.push(item.element);
            }
        }
        return result;
    }
    findAsset(uri: string, instance?: IModule) {
        if (uri) {
            uri = Module.toPosix(uri);
            return this.assets.find(item => Module.toPosix(item.uri) === uri && (!instance || this.hasDocument(instance, item.document)));
        }
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
                    this.writeFail(['Unable to read file', path.basename(localUri)], err, this.logType.FILE);
                }
            }
        }
        return file.sourceUTF8 || '';
    }
    async setAssetContent(file: ExternalAsset, localUri: string, content: string, index = 0, replacePattern?: string) {
        const trailing = concatString(file.trailingContent);
        if (trailing) {
            content += trailing;
        }
        if (index === 0) {
            return content;
        }
        let appending = this.contentToAppend.get(localUri),
            replacing = this.contentToReplace.get(localUri);
        if (!appending) {
            this.contentToAppend.set(localUri, appending = []);
        }
        if (!replacing) {
            this.contentToReplace.set(localUri, replacing = []);
        }
        if (file.document) {
            for (const { instance } of this.Document) {
                if (instance.resolveUri && this.hasDocument(instance, file.document)) {
                    content = instance.resolveUri(file, content);
                }
            }
        }
        appending[index - 1] = content;
        if (replacePattern) {
            replacing[index - 1] = replacePattern;
        }
        file.invalid = true;
        return '';
    }
    getAssetContent(file: ExternalAsset, source?: string) {
        const appending = this.contentToAppend.get(file.localUri!);
        if (appending) {
            if (source) {
                const replacing = this.contentToReplace.get(file.localUri!);
                if (replacing && replacing.length) {
                    for (let i = 0; i < replacing.length; ++i) {
                        const content = appending[i];
                        if (content) {
                            if (replacing[i]) {
                                const match = new RegExp(replacing[i], 'i').exec(source);
                                if (match) {
                                    source = source.substring(0, match.index) + content + '\n' + source.substring(match.index + match[0].length);
                                    continue;
                                }
                            }
                            source += content;
                        }
                    }
                    return source;
                }
            }
            return (source || '') + appending.reduce((a, b) => b ? a + '\n' + b : a, '');
        }
        return source;
    }
    writeBuffer(file: ExternalAsset) {
        const buffer = file.sourceUTF8 ? Buffer.from(file.sourceUTF8, 'utf8') : file.buffer;
        if (buffer) {
            try {
                fs.writeFileSync(file.localUri!, buffer);
                return file.buffer = buffer;
            }
            catch (err) {
                this.writeFail(['Unable to write file', path.basename(file.localUri!)], err, this.logType.FILE);
            }
        }
        return null;
    }
    writeImage(document: StringOfArray, data: OutputData) {
        for (const { instance } of this.Document) {
            if (instance.writeImage && this.hasDocument(instance, document) && instance.writeImage(data)) {
                return true;
            }
        }
        return false;
    }
    addCopy(data: FileData, saveAs?: string, replace = true) {
        const localUri = this.getLocalUri(data);
        if (!localUri) {
            return;
        }
        const document = data.file.document;
        const ext = path.extname(localUri).substring(1);
        let output: Undef<string>;
        saveAs ||= ext;
        if (document) {
            for (const { instance } of this.Document) {
                if (instance.addCopy && this.hasDocument(instance, document) && (output = instance.addCopy(data, saveAs, replace))) {
                    this.filesQueued.add(output);
                    return output;
                }
            }
        }
        if (this.getMimeType(data) === data.outputType || ext === saveAs) {
            if (!replace || this.filesQueued.has(localUri)) {
                let i = 1;
                do {
                    output = Module.renameExt(localUri, '__copy__.' + (i > 1 ? `(${i}).` : '') + saveAs);
                }
                while (this.filesQueued.has(output) && ++i);
                try {
                    fs.copyFileSync(localUri, output);
                }
                catch (err) {
                    this.writeFail(['Unable to copy file', path.basename(localUri)], err, this.logType.FILE);
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
        this.filesQueued.add(output ||= localUri);
        return output;
    }
    async findMime(data: FileData, rename?: boolean) {
        const file = data.file;
        const localUri = this.getLocalUri(data);
        let mimeType = '',
            ext: Undef<string>;
        try {
            const result = await FileManager.resolveMime(file.buffer || localUri);
            if (result) {
                ({ mime: mimeType, ext } = result);
            }
        }
        catch (err) {
            this.writeFail(['Unable to read buffer', path.basename(localUri)], err);
        }
        if (rename) {
            if (!ext) {
                file.invalid = true;
            }
            else {
                const output = Image.renameExt(localUri, ext);
                if (localUri !== output) {
                    fs.renameSync(localUri, output);
                    this.replace(data.file, output, mimeType);
                }
                else {
                    file.mimeType = mimeType;
                }
            }
        }
        if (mimeType) {
            data.mimeType = mimeType;
        }
        return mimeType;
    }
    async compressFile(file: ExternalAsset, overwrite = true) {
        const { localUri, compress } = file;
        if (compress && this.has(localUri)) {
            const tasks: Promise<void>[] = [];
            for (const data of compress) {
                const format = data.format;
                let valid = false;
                switch (format) {
                    case 'gz':
                        valid = true;
                        break;
                    case 'br':
                        valid = this.supported(11, 7);
                        data.mimeType ||= file.mimeType;
                        break;
                    default:
                        valid = typeof Compress.compressors[format] === 'function';
                        break;
                }
                if (!valid || !withinSizeRange(localUri, data.condition)) {
                    continue;
                }
                const output = localUri + '.' + format;
                if (overwrite || !fs.existsSync(output) || fs.statSync(output).mtimeMs < this.startTime) {
                    tasks.push(
                        new Promise<void>(resolve => {
                            const complete = (err?: Null<Error>) => {
                                if (err) {
                                    this.writeFail(['Unable to compress file', path.basename(localUri)], err);
                                }
                                resolve();
                            };
                            try {
                                Compress.tryFile(localUri, output, data, (err?: Null<Error>, result?: string) => {
                                    if (result) {
                                        if (data.condition?.includes('%') && Module.getFileSize(result) >= Module.getFileSize(localUri)) {
                                            try {
                                                fs.unlinkSync(result);
                                            }
                                            catch (err_1) {
                                                this.writeFail(['Unable to delete file', path.basename(result)], err_1, this.logType.FILE);
                                            }
                                        }
                                        else {
                                            this.add(result, file);
                                        }
                                    }
                                    complete(err);
                                });
                            }
                            catch (err) {
                                complete(err);
                            }
                        })
                    );
                }
            }
            if (tasks.length) {
                return Module.allSettled(tasks);
            }
        }
    }
    async transformAsset(data: FileData, parent?: ExternalAsset) {
        const file = data.file;
        const localUri = this.getLocalUri(data);
        if (file.tasks) {
            const taskName = new Set<string>();
            for (const task of file.tasks) {
                if (task.preceding && !taskName.has(task.handler)) {
                    const handler = this.Task.find(item => task.handler === item.instance.moduleName);
                    if (handler) {
                        await handler.constructor.using.call(this, handler.instance, [file], true);
                        taskName.add(task.handler);
                    }
                }
            }
        }
        if (this.Image) {
            let mimeType = file.mimeType;
            if (!mimeType && file.commands || mimeType === 'image/unknown') {
                mimeType = await this.findMime(data, true);
            }
            if (file.commands && mimeType?.startsWith('image/')) {
                const ext = mimeType.split('/')[1];
                const handler = this.Image.get(ext) || this.Image.get('handler');
                if (handler) {
                    for (const command of file.commands) {
                        if (withinSizeRange(localUri, command)) {
                            handler.using.call(this, data, command);
                        }
                    }
                }
            }
        }
        if (file.document) {
            for (const { instance, constructor } of this.Document) {
                if (this.hasDocument(instance, file.document)) {
                    await constructor.using.call(this, instance, file);
                }
            }
        }
        if (file.invalid) {
            try {
                if (localUri && fs.existsSync(localUri) && !file.bundleId) {
                    fs.unlinkSync(localUri);
                }
            }
            catch (err) {
                this.writeFail(['Unable to delete file', path.basename(localUri)], err, this.logType.FILE);
            }
            this.completeAsyncTask();
        }
        else {
            this.completeAsyncTask(null, localUri, parent);
        }
    }
    processAssets(emptyDir?: boolean) {
        const processing: ObjectMap<ExternalAsset[]> = {};
        const downloading: ObjectMap<ExternalAsset[]> = {};
        const appending: ObjectMap<ExternalAsset[]> = {};
        const completed: string[] = [];
        const emptied: string[] = [];
        const notFound: string[] = [];
        const checkQueue = (file: ExternalAsset, localUri: string, content?: boolean) => {
            const bundleIndex = file.bundleIndex;
            if (bundleIndex !== undefined && bundleIndex >= 0) {
                const bundle = appending[localUri] ||= [];
                if (bundleIndex > 0) {
                    bundle[bundleIndex - 1] = file;
                    return true;
                }
            }
            else if (!content) {
                if (completed.includes(localUri)) {
                    this.transformAsset({ file });
                    return true;
                }
                const queue = processing[localUri];
                if (queue) {
                    queue.push(file);
                    return true;
                }
                processing[localUri] = [file];
            }
            return false;
        };
        const processQueue = async (file: ExternalAsset, localUri: string, bundleMain?: ExternalAsset) => {
            const bundleIndex = file.bundleIndex;
            if (bundleIndex !== undefined && bundleIndex >= 0) {
                let cloudStorage: Undef<CloudService[]>;
                if (bundleIndex === 0) {
                    const content = await this.setAssetContent(file, localUri, this.getUTF8String(file, localUri));
                    if (content) {
                        file.sourceUTF8 = content;
                        file.invalid = false;
                        bundleMain = file;
                    }
                    else {
                        file.bundleIndex = Infinity;
                        file.invalid = true;
                        cloudStorage = file.cloudStorage;
                        delete file.sourceUTF8;
                    }
                }
                const items = appending[localUri];
                if (items) {
                    let queue: Undef<ExternalAsset>;
                    while (!queue && items.length) {
                        queue = items.shift();
                    }
                    if (queue) {
                        const { uri, content } = queue;
                        const verifyBundle = async (next: ExternalAsset, value: string) => {
                            if (bundleMain) {
                                return this.setAssetContent(next, localUri, value, next.bundleIndex, next.bundleReplace);
                            }
                            if (value) {
                                next.sourceUTF8 = await this.setAssetContent(next, localUri, value);
                                next.cloudStorage = cloudStorage;
                                bundleMain = queue;
                            }
                            else {
                                next.invalid = true;
                            }
                        };
                        const resumeQueue = () => processQueue(queue!, localUri, bundleMain);
                        if (content) {
                            verifyBundle(queue, content).then(resumeQueue);
                        }
                        else if (uri) {
                            request(uri, (err, res) => {
                                if (err || res.statusCode >= 300) {
                                    this.writeFail(['Unable to download file', uri], err || res.statusCode + ' ' + res.statusMessage);
                                    notFound.push(uri);
                                    queue!.invalid = true;
                                    resumeQueue();
                                }
                                else {
                                    queue!.etag = (res.headers.etag || res.headers['last-modified']) as string;
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
                    this.transformAsset({ file: bundleMain || file });
                }
                else {
                    this.completeAsyncTask();
                }
                delete appending[localUri];
            }
            else {
                const uri = file.uri!;
                const copying = downloading[uri];
                const ready = processing[localUri];
                if (file.invalid) {
                    if (copying?.length) {
                        copying.forEach(item => item.invalid = true);
                    }
                    if (ready) {
                        ready.forEach(item => item.invalid = true);
                    }
                }
                else {
                    completed.push(localUri);
                    if (copying?.length) {
                        const files: string[] = [];
                        const uriMap = new Map<string, ExternalAsset[]>();
                        for (const item of copying) {
                            const copyUri = item.localUri!;
                            const items = uriMap.get(copyUri) || [];
                            if (items.length === 0) {
                                const pathname = path.dirname(copyUri);
                                try {
                                    fs.mkdirpSync(pathname);
                                }
                                catch (err) {
                                    this.writeFail(['Unable to create directory', this.removeCwd(pathname)], err, this.logType.FILE);
                                    item.invalid = true;
                                    continue;
                                }
                                files.push(copyUri);
                            }
                            items.push(item);
                            uriMap.set(copyUri, items);
                        }
                        for (const copyUri of files) {
                            try {
                                fs.copyFileSync(localUri, copyUri);
                                for (const queue of uriMap.get(copyUri)!) {
                                    this.performAsyncTask();
                                    this.transformAsset({ file: queue });
                                }
                            }
                            catch (err) {
                                for (const queue of uriMap.get(copyUri)!) {
                                    queue.invalid = true;
                                }
                                this.writeFail(['Unable to copy file', path.basename(localUri)], err, this.logType.FILE);
                            }
                        }
                    }
                    if (ready) {
                        for (const item of ready) {
                            if (item !== file) {
                                this.performAsyncTask();
                            }
                            this.transformAsset({ file: item });
                        }
                    }
                    else {
                        this.transformAsset({ file });
                    }
                }
                delete downloading[uri];
                delete processing[localUri];
            }
        };
        const errorRequest = (file: ExternalAsset, uri: string, localUri: string, err: Error, stream?: fs.WriteStream) => {
            file.invalid = true;
            if (downloading[uri]) {
                downloading[uri]!.forEach(item => item.invalid = true);
                delete downloading[uri];
            }
            delete processing[localUri];
            if (!notFound.includes(uri)) {
                if (appending[localUri]) {
                    processQueue(file, localUri);
                }
                else {
                    this.completeAsyncTask();
                }
                notFound.push(uri);
            }
            if (stream) {
                try {
                    stream.close();
                    fs.unlink(localUri);
                }
                catch (err_1) {
                    this.writeFail(['Unable to delete file', path.basename(localUri)], err_1, this.logType.FILE);
                }
            }
            this.writeFail(['Unable to download file', uri], err);
        };
        for (const item of this.assets) {
            if (!item.filename) {
                item.invalid = true;
                continue;
            }
            const { pathname, localUri } = this.setLocalUri(item);
            const fileReceived = (err?: NodeJS.ErrnoException) => {
                if (err) {
                    item.invalid = true;
                }
                if (!err || appending[localUri]) {
                    processQueue(item, localUri);
                }
                else {
                    this.completeAsyncTask(err, localUri);
                }
            };
            const createFolder = () => {
                if (!emptied.includes(pathname)) {
                    if (emptyDir) {
                        try {
                            fs.emptyDirSync(pathname);
                        }
                        catch (err) {
                            this.writeFail(['Unable to empty sub directory', this.removeCwd(pathname)], err);
                        }
                    }
                    try {
                        fs.mkdirpSync(pathname);
                        emptied.push(pathname);
                    }
                    catch (err) {
                        this.writeFail(['Unable to create directory', this.removeCwd(pathname)], err, this.logType.FILE);
                        item.invalid = true;
                        return false;
                    }
                }
                return true;
            };
            if (item.content) {
                if (!checkQueue(item, localUri, true) && createFolder()) {
                    item.sourceUTF8 = item.content;
                    this.performAsyncTask();
                    fs.writeFile(localUri, item.content, 'utf8', err => fileReceived(err));
                }
            }
            else if (item.base64) {
                if (createFolder()) {
                    this.performAsyncTask();
                    fs.writeFile(localUri, item.base64, 'base64', err => {
                        if (!err) {
                            this.transformAsset({ file: item });
                        }
                        else {
                            item.invalid = true;
                            this.completeAsyncTask(err);
                        }
                    });
                }
            }
            else {
                const uri = item.uri;
                if (!uri || notFound.includes(uri)) {
                    item.invalid = true;
                    continue;
                }
                try {
                    if (Module.isFileHTTP(uri)) {
                        if (!checkQueue(item, localUri)) {
                            if (downloading[uri]) {
                                downloading[uri]!.push(item);
                                continue;
                            }
                            if (createFolder()) {
                                const { hostname, port } = new URL(uri);
                                this.performAsyncTask();
                                downloading[uri] = [];
                                let tempDir = '';
                                if (this.cacheHttpRequest) {
                                    tempDir = this.getTempDir(false, hostname + (port ? '_' + port : ''));
                                    try {
                                        if (!fs.pathExistsSync(tempDir)) {
                                            fs.mkdirpSync(tempDir);
                                        }
                                    }
                                    catch (err) {
                                        this.writeFail(['Unable to create directory', tempDir], err, this.logType.FILE);
                                        tempDir = '';
                                    }
                                }
                                const downloadUri = (etag?: string) => {
                                    const stream = fs.createWriteStream(localUri);
                                    stream.on('finish', () => {
                                        if (!notFound.includes(uri)) {
                                            processQueue(item, localUri);
                                            if (tempDir && etag) {
                                                try {
                                                    if (!fs.pathExistsSync(tempDir = path.join(tempDir, etag))) {
                                                        fs.mkdirSync(tempDir);
                                                    }
                                                    fs.copyFileSync(localUri, path.join(tempDir, path.basename(localUri)));
                                                }
                                                catch {
                                                }
                                            }
                                        }
                                    });
                                    request(uri)
                                        .on('response', res => {
                                            if (this.Watch) {
                                                item.etag = (res.headers.etag || res.headers['last-modified']) as string;
                                            }
                                            const statusCode = res.statusCode;
                                            if (statusCode >= 300) {
                                                errorRequest(item, uri, localUri, new Error(statusCode + ' ' + res.statusMessage), stream);
                                            }
                                        })
                                        .on('data', data => {
                                            if (Buffer.isBuffer(data)) {
                                                item.buffer = item.buffer ? Buffer.concat([item.buffer, data]) : data;
                                            }
                                        })
                                        .on('error', err => errorRequest(item, uri, localUri, err, stream))
                                        .pipe(stream);
                                };
                                if (tempDir) {
                                    request(uri, { method: 'HEAD' })
                                        .on('response', res => {
                                            const statusCode = res.statusCode;
                                            if (statusCode >= 300) {
                                                errorRequest(item, uri, localUri, new Error(statusCode + ' ' + res.statusMessage));
                                            }
                                            else {
                                                const etag = res.headers.etag as Undef<string>;
                                                let subDir: Undef<string>;
                                                if (Module.isString(etag)) {
                                                    subDir = encodeURIComponent(etag);
                                                    const tempUri = path.join(tempDir, subDir, path.basename(localUri));
                                                    if (fs.existsSync(tempUri)) {
                                                        if (this.Watch) {
                                                            item.etag = etag;
                                                        }
                                                        if (!this.archiving && fs.existsSync(localUri) && fs.statSync(tempUri).mtimeMs === fs.statSync(localUri).mtimeMs) {
                                                            fileReceived();
                                                        }
                                                        else {
                                                            try {
                                                                fs.copyFileSync(tempUri, localUri);
                                                                fileReceived();
                                                            }
                                                            catch (err) {
                                                                downloadUri(subDir);
                                                                this.writeFail(['Unable to copy file', path.basename(tempUri)], err, this.logType.FILE);
                                                            }
                                                        }
                                                        return;
                                                    }
                                                }
                                                downloadUri(subDir);
                                            }
                                        })
                                        .on('error', err => errorRequest(item, uri, localUri, err));
                                }
                                else {
                                    downloadUri();
                                }
                            }
                        }
                    }
                    else if (Module.isFileUNC(uri) && this.permission.hasUNCRead(uri) || path.isAbsolute(uri) && this.permission.hasDiskRead(uri)) {
                        if (!checkQueue(item, localUri) && createFolder()) {
                            if (!this.archiving && fs.existsSync(localUri)) {
                                const statSrc = fs.statSync(uri);
                                const statDest = fs.statSync(localUri);
                                if (statSrc.size === statDest.size && statSrc.mtimeMs === statDest.mtimeMs) {
                                    continue;
                                }
                            }
                            this.performAsyncTask();
                            fs.copyFile(uri, localUri, err => fileReceived(err));
                        }
                    }
                    else {
                        item.invalid = true;
                    }
                }
                catch (err) {
                    errorRequest(item, uri, localUri, err);
                }
            }
        }
        this.cleared = true;
    }
    async finalize() {
        let tasks: Promise<unknown>[] = [];
        const removeFiles = () => {
            const filesToRemove = this.filesToRemove;
            if (filesToRemove.size) {
                for (const value of filesToRemove) {
                    try {
                        fs.unlinkSync(value);
                        this.delete(value);
                    }
                    catch (err) {
                        if (err.code !== 'ENOENT') {
                            this.writeFail(['Unable to delete file', path.basename(value)], err, this.logType.FILE);
                        }
                        else {
                            this.delete(value);
                        }
                    }
                }
                filesToRemove.clear();
            }
        };
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
        removeFiles();
        if (this.Compress) {
            for (const item of this.assets) {
                if (item.compress && item.mimeType?.startsWith('image/') && !item.invalid) {
                    const files = [item.localUri!];
                    if (item.transforms) {
                        files.push(...item.transforms);
                    }
                    for (const file of files) {
                        if (this.has(file)) {
                            for (const image of item.compress) {
                                if (withinSizeRange(file, image.condition)) {
                                    tasks.push(new Promise(resolve => {
                                        const complete = (err?: Null<Error>) => {
                                            if (err) {
                                                this.writeFail(['Unable to compress image', path.basename(file)], err);
                                            }
                                            resolve(null);
                                        };
                                        try {
                                            Compress.tryImage(file, image, (err?: Null<Error>, value?: Null<unknown>) => {
                                                if (file === item.localUri) {
                                                    item.buffer = value instanceof Buffer ? value : undefined;
                                                }
                                                complete(err);
                                            });
                                        }
                                        catch (err) {
                                            complete(err);
                                        }
                                    }));
                                }
                            }
                        }
                    }
                }
            }
            if (tasks.length) {
                await Module.allSettled(tasks);
                tasks = [];
            }
        }
        for (const { instance, constructor } of this.Document) {
            if (instance.assets.length) {
                await constructor.finalize.call(this, instance);
            }
        }
        for (const item of this.assets) {
            if (item.sourceUTF8 && !item.invalid) {
                tasks.push(fs.writeFile(item.localUri!, item.sourceUTF8, 'utf8'));
            }
        }
        if (tasks.length) {
            await Module.allSettled(tasks, 'Write modified files', this.errors);
            tasks = [];
        }
        removeFiles();
        if (this.taskAssets.length) {
            for (const { instance, constructor } of this.Task) {
                const assets = this.taskAssets.filter(item => item.tasks!.find(data => data.handler === instance.moduleName && !data.preceding && item.localUri && !item.invalid));
                if (assets.length) {
                    await constructor.using.call(this, instance, assets);
                }
            }
        }
        removeFiles();
        if (this.Cloud) {
            await Cloud.finalize.call(this, this.Cloud);
        }
        removeFiles();
        if (this.Compress) {
            for (const item of this.assets) {
                if (item.compress && !item.invalid) {
                    tasks.push(this.compressFile(item, false));
                }
            }
            if (tasks.length) {
                await Module.allSettled(tasks, 'Compress files', this.errors);
                tasks = [];
            }
        }
        if (this.Watch) {
            this.Watch.start(this.assets, this.permission);
        }
        for (const value of Array.from(this.emptyDir).reverse()) {
            try {
                fs.rmdirSync(value);
            }
            catch {
            }
        }
        for (const { instance, constructor } of this.Document) {
            if (instance.assets.length) {
                await constructor.cleanup.call(this, instance);
            }
        }
    }
    get cleared() {
        return this._cleared;
    }
    set cleared(value) {
        this._cleared = value;
        if (value) {
            this.performFinalize();
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileManager;
    module.exports.default = FileManager;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default FileManager;