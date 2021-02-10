import type { CompressFormat, ElementAction } from '../types/lib/squared';

import type { DocumentConstructor, ICloud, ICompress, IDocument, IFileManager, IModule, IPermission, ITask, IWatch, ImageConstructor, TaskConstructor } from '../types/lib';
import type { ExternalAsset, FileData, FileOutput, OutputData } from '../types/lib/asset';
import type { CloudService } from '../types/lib/cloud';
import type { InstallData } from '../types/lib/filemanager';
import type { CloudModule, DocumentModule } from '../types/lib/module';
import type { PermissionSettings, RequestBody, Settings } from '../types/lib/node';

import path = require('path');
import fs = require('fs-extra');
import request = require('request');
import mime = require('mime-types');
import fileType = require('file-type');

import Module from '../module';
import Document from '../document';
import Task from '../task';
import Image from '../image';
import Cloud from '../cloud';
import Watch from '../watch';
import Permission from './permission';

import Compress from '../compress';

function parseSizeRange(value: string): [number, number] {
    const match = /\(\s*(\d+)\s*,\s*(\d+|\*)\s*\)/.exec(value);
    return match ? [+match[1], match[2] === '*' ? Infinity : +match[2]] : [0, Infinity];
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

const concatString = (values: Undef<string[]>) => values ? values.reduce((a, b) => a + '\n' + b, '') : '';
const findFormat = (compress: Undef<CompressFormat[]>, format: string) => compress ? compress.filter(item => item.format === format) : [];
const isObject = <T = PlainObject>(value: unknown): value is T => typeof value === 'object' && value !== null;
const isFunction = <T>(value: unknown): value is T => typeof value === 'function';

class FileManager extends Module implements IFileManager {
    static loadSettings(value: Settings) {
        if (value.compress) {
            const { gzip_level, brotli_quality, chunk_size } = value.compress;
            const gzip = +(gzip_level as string);
            const brotli = +(brotli_quality as string);
            const chunkSize = +(chunk_size as string);
            if (!isNaN(gzip)) {
                Compress.level.gz = gzip;
            }
            if (!isNaN(brotli)) {
                Compress.level.br = brotli;
            }
            if (!isNaN(chunkSize) && chunkSize > 0 && chunkSize % 1024 === 0) {
                Compress.chunkSize = chunkSize;
            }
        }
        super.loadSettings(value);
    }

    static moduleCompress() {
        return Compress;
    }

    static getPermission(settings?: PermissionSettings) {
        return new Permission(settings);
    }

    static hasPermission(dirname: string, permission: IPermission) {
        if (Module.isDirectoryUNC(dirname)) {
            if (!permission.hasUNCWrite()) {
                return Module.responseError('Writing to UNC shares is not enabled.', 'NODE (cli): --unc-write');
            }
        }
        else if (!permission.hasDiskWrite()) {
            return Module.responseError('Writing to disk is not enabled.', 'NODE (cli): --disk-write');
        }
        try {
            if (!fs.existsSync(dirname)) {
                fs.mkdirpSync(dirname);
            }
            else if (!fs.lstatSync(dirname).isDirectory()) {
                throw new Error('Target is not a directory.');
            }
        }
        catch (err) {
            return Module.responseError(err, 'DIRECTORY: ' + dirname);
        }
        return true;
    }

    static resolveMime(data: Buffer | string) {
        return data instanceof Buffer ? fileType.fromBuffer(data) : fileType.fromFile(data);
    }

    delayed = 0;
    cleared = false;
    Image: Null<Map<string, ImageConstructor>> = null;
    Document: InstallData<IDocument, DocumentConstructor>[] = [];
    Task: InstallData<ITask, TaskConstructor>[] = [];
    Cloud: Null<ICloud> = null;
    Watch: Null<IWatch> = null;
    Compress: Null<ICompress> = null;
    readonly assets: ExternalAsset[];
    readonly documentAssets: ExternalAsset[] = [];
    readonly taskAssets: ExternalAsset[] = [];
    readonly files = new Set<string>();
    readonly filesQueued = new Set<string>();
    readonly filesToRemove = new Set<string>();
    readonly filesToCompare = new Map<ExternalAsset, string[]>();
    readonly contentToAppend = new Map<string, string[]>();
    readonly emptyDir = new Set<string>();
    readonly permission: IPermission;
    readonly postFinalize?: (errors: string[]) => void;

    constructor(
        readonly baseDirectory: string,
        readonly body: RequestBody,
        postFinalize?: (errors: string[]) => void,
        settings: PermissionSettings = {})
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
        if (postFinalize) {
            this.postFinalize = postFinalize.bind(this);
        }
        this.permission = new Permission(settings);
    }

    install(name: string, ...params: unknown[]) {
        const target = params.shift();
        switch (name) {
            case 'document':
                if (isFunction<DocumentConstructor>(target) && target.prototype instanceof Document) {
                    const instance = new target(params[0] as DocumentModule, this.body.templateMap, ...params.slice(1));
                    instance.init(this.getDocumentAssets(instance), this.body);
                    this.Document.push({ instance, constructor: target, params });
                }
                break;
            case 'task':
                if (isFunction<TaskConstructor>(target) && target.prototype instanceof Task && isObject(params[0])) {
                    const instance = new target(params[0]);
                    this.Task.push({ instance, constructor: target, params });
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
                this.Compress = Compress;
                break;
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
    completeAsyncTask(err: Null<Error> = null, localUri?: string, parent?: ExternalAsset) {
        if (this.delayed !== Infinity) {
            if (localUri) {
                this.add(localUri, parent);
            }
            this.removeAsyncTask();
            this.performFinalize();
        }
        if (err) {
            this.writeFail('Unknown', err);
        }
    }
    performFinalize() {
        if (this.cleared && this.delayed <= 0) {
            this.delayed = Infinity;
            this.finalize().then(() => {
                if (this.postFinalize) {
                    const errors = this.errors.slice(0);
                    const addErrors = (list: string[]) => {
                        if (list.length) {
                            errors.push(...list);
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
                    this.postFinalize(errors);
                    this.errors.length = 0;
                }
            });
        }
    }
    hasDocument(instance: IModule, document: Undef<StringOfArray>) {
        const moduleName = instance.moduleName;
        return moduleName && document ? Array.isArray(document) && document.includes(moduleName) || document === moduleName : false;
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
        file.pathname = Module.toPosix(file.pathname);
        if (file.document) {
            for (const { instance } of this.Document) {
                if (instance.setLocalUri && this.hasDocument(instance, file.document)) {
                    instance.setLocalUri(file, this);
                }
            }
        }
        const segments = [this.baseDirectory, file.moveTo, file.pathname].filter(value => value) as string[];
        const pathname = segments.length > 1 ? path.join(...segments) : this.baseDirectory;
        const localUri = path.join(pathname, file.filename);
        file.localUri = localUri;
        file.relativeUri = this.getRelativeUri(file);
        file.mimeType ||= mime.lookup(uri || localUri) || '';
        return { pathname, localUri } as FileOutput;
    }
    getLocalUri(data: FileData) {
        return data.file.localUri || '';
    }
    getMimeType(data: FileData) {
        return data.mimeType || (data.mimeType = mime.lookup(this.getLocalUri(data)) || data.file.mimeType);
    }
    getRelativeUri(file: ExternalAsset, filename = file.filename) {
        return Module.joinPosix(file.moveTo, file.pathname, filename);
    }
    getDocumentAssets(instance: IModule) {
        const moduleName = instance.moduleName;
        return moduleName ? this.documentAssets.filter(item => item.document!.includes(moduleName)) : [];
    }
    getCloudAssets(instance: IModule) {
        return this.Cloud ? this.Cloud.database.filter(item => this.hasDocument(instance, item.document) && item.element) : [];
    }
    getElements() {
        return (this.documentAssets as ElementAction[]).filter(item => item.element).concat((this.Cloud?.database || []) as ElementAction[]).filter(item => item.element).map(item => item.element!);
    }
    findAsset(uri: string, instance?: IModule) {
        if (uri) {
            return this.assets.find(item => item.uri === uri && (!instance || this.hasDocument(instance, item.document)));
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
                    this.writeFail(['File not found', path.basename(localUri)], err);
                }
            }
        }
        return file.sourceUTF8 || '';
    }
    async setAssetContent(file: ExternalAsset, localUri: string, content: string, index = 0) {
        const trailing = concatString(file.trailingContent);
        if (trailing) {
            content += trailing;
        }
        if (file.document) {
            for (const { instance } of this.Document) {
                if (instance.formatContent && this.hasDocument(instance, file.document)) {
                    const result = await instance.formatContent(file, content, this);
                    if (result) {
                        content = result;
                    }
                }
            }
        }
        if (index === 0) {
            return content;
        }
        const items = this.contentToAppend.get(localUri) || [];
        items[index - 1] = content;
        this.contentToAppend.set(localUri, items);
        return '';
    }
    getAssetContent(file: ExternalAsset) {
        const content = this.contentToAppend.get(file.localUri!);
        if (content) {
            return content.reduce((a, b) => b ? a + '\n' + b : a, '');
        }
    }
    writeBuffer(file: ExternalAsset) {
        const buffer = file.sourceUTF8 ? Buffer.from(file.sourceUTF8, 'utf8') : file.buffer;
        if (buffer) {
            try {
                fs.writeFileSync(file.localUri!, buffer);
                return file.buffer = buffer;
            }
            catch (err) {
                this.writeFail(['Unable to write buffer', file.localUri!], err);
            }
        }
        return null;
    }
    writeImage(document: StringOfArray, data: OutputData) {
        for (const { instance } of this.Document) {
            if (instance.writeImage && this.hasDocument(instance, document) && instance.writeImage(data, this)) {
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
                if (instance.addCopy && this.hasDocument(instance, document) && (output = instance.addCopy(data, saveAs, replace, this))) {
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
    async compressFile(file: ExternalAsset) {
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
                if (valid && withinSizeRange(localUri, data.condition) && !fs.existsSync(localUri + '.' + format)) {
                    tasks.push(
                        new Promise<void>(resolve => {
                            try {
                                Compress.tryFile(localUri, data, null, (err?: Null<Error>, result?: string) => {
                                    if (err) {
                                        throw err;
                                    }
                                    if (result) {
                                        if (data.condition?.includes('%') && Module.getFileSize(result) >= Module.getFileSize(localUri)) {
                                            try {
                                                fs.unlinkSync(result);
                                            }
                                            catch {
                                            }
                                        }
                                        else {
                                            this.add(result, file);
                                        }
                                    }
                                    resolve();
                                });
                            }
                            catch (err) {
                                this.writeFail(['Unable to compress file', path.basename(localUri)], err);
                                resolve();
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
            let mimeType = file.mimeType || '';
            if (!mimeType && file.commands || mimeType === 'image/unknown') {
                mimeType = await this.findMime(data, true);
            }
            if (file.commands && mimeType.startsWith('image/')) {
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
            if (!file.bundleId) {
                try {
                    fs.unlinkSync(localUri);
                }
                catch (err) {
                    this.writeFail(['Unable to delete file', path.basename(localUri)], err);
                }
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
        const emptied = new Set<string>();
        const notFound: ObjectMap<boolean> = {};
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
            if (bundleIndex !== undefined && bundleIndex !== -1) {
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
                        const verifyBundle = async (next: ExternalAsset, value: string) => {
                            if (bundleMain) {
                                return this.setAssetContent(next, localUri, value, next.bundleIndex);
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
                        const { uri, content } = queue;
                        if (content) {
                            verifyBundle(queue, content).then(resumeQueue);
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
                        for (const item of copying) {
                            item.invalid = true;
                        }
                    }
                    if (ready) {
                        for (const item of ready) {
                            item.invalid = true;
                        }
                    }
                }
                else {
                    completed.push(localUri);
                    if (copying?.length) {
                        const tasks: Promise<void>[] = [];
                        const uriMap = new Map<string, ExternalAsset[]>();
                        for (const item of copying) {
                            const copyUri = item.localUri!;
                            if (!uriMap.has(copyUri)) {
                                const pathname = path.dirname(copyUri);
                                try {
                                    fs.mkdirpSync(pathname);
                                }
                                catch (err) {
                                    this.writeFail(['Unable to create directory', pathname], err);
                                    item.invalid = true;
                                    continue;
                                }
                                tasks.push(
                                    fs.copyFile(localUri, copyUri)
                                        .then(() => {
                                            for (const queue of uriMap.get(copyUri)!) {
                                                this.performAsyncTask();
                                                this.transformAsset({ file: queue });
                                            }
                                        })
                                        .catch(err => {
                                            for (const queue of uriMap.get(copyUri)!) {
                                                queue.invalid = true;
                                            }
                                            this.writeFail(['Unable to copy downloaded file', localUri], err);
                                        })
                                );
                            }
                            const items = uriMap.get(copyUri) || [];
                            items.push(item);
                            uriMap.set(copyUri, items);
                        }
                        await Promise.all(tasks);
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
                for (const item of downloading[uri]) {
                    item.invalid = true;
                }
                delete downloading[uri];
            }
            delete processing[localUri];
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
                    this.completeAsyncTask(err);
                }
            };
            const createFolder = () => {
                if (!emptied.has(pathname)) {
                    if (emptyDir) {
                        try {
                            fs.emptyDirSync(pathname);
                        }
                        catch (err) {
                            this.writeFail(['Unable to empty sub directory', pathname], err);
                        }
                    }
                    try {
                        fs.mkdirpSync(pathname);
                        emptied.add(pathname);
                    }
                    catch (err) {
                        this.writeFail(['Unable to create directory', pathname], err);
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
                if (!uri || notFound[uri]) {
                    item.invalid = true;
                    continue;
                }
                try {
                    if (Module.isFileHTTP(uri)) {
                        if (!checkQueue(item, localUri)) {
                            if (downloading[uri]) {
                                downloading[uri].push(item);
                                continue;
                            }
                            if (createFolder()) {
                                const stream = fs.createWriteStream(localUri);
                                stream.on('finish', () => {
                                    if (!notFound[uri]) {
                                        processQueue(item, localUri);
                                    }
                                });
                                downloading[uri] = [];
                                this.performAsyncTask();
                                request(uri)
                                    .on('response', response => {
                                        if (this.Watch) {
                                            item.etag = (response.headers['etag'] || response.headers['last-modified']) as string;
                                        }
                                        const statusCode = response.statusCode;
                                        if (statusCode >= 300) {
                                            errorRequest(item, uri, localUri, new Error(statusCode + ' ' + response.statusMessage), stream);
                                        }
                                    })
                                    .on('data', data => {
                                        if (Buffer.isBuffer(data)) {
                                            item.buffer = item.buffer ? Buffer.concat([item.buffer, data]) : data;
                                        }
                                    })
                                    .on('error', err => errorRequest(item, uri, localUri, err, stream))
                                    .pipe(stream);
                            }
                        }
                    }
                    else if (this.permission.hasUNCRead() && Module.isFileUNC(uri) || this.permission.hasDiskRead() && path.isAbsolute(uri)) {
                        if (!checkQueue(item, localUri) && createFolder()) {
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
        this.performFinalize();
    }
    async finalize() {
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
                const assets = this.getDocumentAssets(instance);
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
            await Module.allSettled(tasks, 'Write modified files <finalize>', this.errors);
            tasks = [];
        }
        for (const value of this.filesToRemove) {
            tasks.push(
                fs.unlink(value)
                    .then(() => this.delete(value))
                    .catch(err => {
                        if (err.code !== 'ENOENT') {
                            this.writeFail(['Unable to delete file', value], err);
                        }
                    })
            );
        }
        if (tasks.length) {
            await Module.allSettled(tasks);
            tasks = [];
        }
        if (this.Compress) {
            for (const item of this.assets) {
                if (item.compress && !item.invalid) {
                    const files = [item.localUri!];
                    if (item.transforms) {
                        files.push(...item.transforms);
                    }
                    for (const file of files) {
                        const mimeType = mime.lookup(file);
                        if (mimeType && mimeType.startsWith('image/')) {
                            for (const image of findFormat(item.compress, mimeType.split('/')[1])) {
                                if (withinSizeRange(file, image.condition)) {
                                    tasks.push(new Promise(resolve => {
                                        try {
                                            Compress.tryImage(file, image, resolve);
                                        }
                                        catch (err) {
                                            this.writeFail(['Unable to compress image', path.basename(file)], err);
                                            resolve(null);
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
        if (this.taskAssets.length) {
            for (const { instance, constructor } of this.Task) {
                const assets = this.taskAssets.filter(item => item.tasks!.find(data => data.handler === instance.moduleName && !data.preceding && item.localUri && !item.invalid));
                if (assets.length) {
                    await constructor.using.call(this, instance, assets);
                }
            }
        }
        if (this.Cloud) {
            await Cloud.finalize.call(this, this.Cloud);
        }
        if (this.Compress) {
            for (const item of this.assets) {
                if (item.compress && !item.invalid) {
                    tasks.push(this.compressFile(item));
                }
            }
            if (tasks.length) {
                await Module.allSettled(tasks, 'Compress files <finalize>', this.errors);
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
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileManager;
    module.exports.default = FileManager;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default FileManager;