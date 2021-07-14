import type { DataSource, FileInfo } from '../types/lib/squared';

import type { DocumentConstructor, ICloud, ICompress, IDocument, IFileManager, IModule, ITask, IWatch, ImageConstructor, TaskConstructor } from '../types/lib';
import type { ExternalAsset, FileData, FileOutput, OutputData } from '../types/lib/asset';
import type { CloudDatabase } from '../types/lib/cloud';
import type { FetchBufferOptions, HttpClientOptions, HttpHostData, HttpHostRequest, HttpRequestBuffer, HttpVersionSupport, InstallData, PostFinalizeCallback } from '../types/lib/filemanager';
import type { CloudModule, DocumentModule } from '../types/lib/module';
import type { RequestBody } from '../types/lib/node';

import type { ClientRequest, IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders } from 'http';
import type { ClientHttp2Stream } from 'http2';
import type { Transform } from 'stream';

import path = require('path');
import fs = require('fs-extra');
import http2 = require('http2');
import stream = require('stream');
import zlib = require('zlib');
import httpStatus = require('http-status-codes');
import followRedirects = require('follow-redirects');
import mime = require('mime-types');
import filetype = require('file-type');
import bytes = require('bytes');
import Module from '../module';
import Document from '../document';
import Task from '../task';
import Image from '../image';
import Cloud from '../cloud';
import Watch from '../watch';
import Permission from './permission';

import Compress from '../compress';

const { http, https } = followRedirects;

const enum HTTP2 { // eslint-disable-line no-shadow
    MAX_FAILED = 5
}

const enum HTTP_STATUS { // eslint-disable-line no-shadow
    CONTINUE = 100,
    SWITCHING_PROTOCOLS = 101,
    PROCESSING = 102,
    OK = 200,
    CREATED = 201,
    ACCEPTED = 202,
    NON_AUTHORITATIVE_INFORMATION = 203,
    NO_CONTENT = 204,
    RESET_CONTENT = 205,
    PARTIAL_CONTENT = 206,
    MULTI_STATUS = 207,
    ALREADY_REPORTED = 208,
    IM_USED = 226,
    MULTIPLE_CHOICES = 300,
    MOVED_PERMANENTLY = 301,
    FOUND = 302,
    SEE_OTHER = 303,
    NOT_MODIFIED = 304,
    USE_PROXY = 305,
    TEMPORARY_REDIRECT = 307,
    PERMANENT_REDIRECT = 308,
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    PAYMENT_REQUIRED = 402,
    FORBIDDEN = 403,
    NOT_FOUND = 404,
    METHOD_NOT_ALLOWED = 405,
    NOT_ACCEPTABLE = 406,
    PROXY_AUTHENTICATION_REQUIRED = 407,
    REQUEST_TIMEOUT = 408,
    CONFLICT = 409,
    GONE = 410,
    LENGTH_REQUIRED = 411,
    PRECONDITION_FAILED = 412,
    PAYLOAD_TOO_LARGE = 413,
    REQUEST_URI_TOO_LONG = 414,
    UNSUPPORTED_MEDIA_TYPE = 415,
    REQUESTED_RANGE_NOT_SATISFIABLE = 416,
    EXPECTATION_FAILED = 417,
    IM_A_TEAPOT = 418,
    MISDIRECTED_REQUEST = 421,
    UNPROCESSABLE_ENTITY = 422,
    LOCKED = 423,
    FAILED_DEPENDENCY = 424,
    UPGRADE_REQUIRED = 426,
    PRECONDITION_REQUIRED = 428,
    TOO_MANY_REQUESTS = 429,
    REQUEST_HEADER_FIELDS_TOO_LARGE = 431,
    CONNECTION_CLOSED_WITHOUT_RESPONSE = 444,
    UNAVAILABLE_FOR_LEGAL_REASONS = 451,
    CLIENT_CLOSED_REQUEST = 499,
    INTERNAL_SERVER_ERROR = 500,
    NOT_IMPLEMENTED = 501,
    BAD_GATEWAY = 502,
    SERVICE_UNAVAILABLE = 503,
    GATEWAY_TIMEOUT = 504,
    HTTP_VERSION_NOT_SUPPORTED = 505,
    VARIANT_ALSO_NEGOTIATES = 506,
    INSUFFICIENT_STORAGE = 507,
    LOOP_DETECTED = 508,
    NOT_EXTENDED = 510,
    NETWORK_AUTHENTICATION_REQUIRED = 511,
    NETWORK_CONNECT_TIMEOUT_ERROR = 599
}

const HTTP2_UNSUPPORTED = [
    http2.constants.NGHTTP2_PROTOCOL_ERROR /* 1 */,
    http2.constants.NGHTTP2_CONNECT_ERROR /* 10 */,
    http2.constants.NGHTTP2_INADEQUATE_SECURITY /* 12 */,
    http2.constants.NGHTTP2_HTTP_1_1_REQUIRED /* 13 */
];
const HTTP_HOST: ObjectMap<HttpHostData> = {};
const HTTP_BUFFER: ObjectMap<Null<[string, Buffer]>> = {};
const HTTP_BROTLISUPPORT = Module.supported(11, 7) || Module.supported(10, 16, 0, true);
let HTTP_RETRYLIMIT = 3;
let HTTP_RETRYDELAY = 1000;

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

function downgradeHost(host: HttpHostData) {
    const { version, failed } = host;
    if (version === 2) {
        if (!failed[0]) {
            failed[0] = 1;
        }
        else {
            failed[0]++;
        }
        host.version = 1;
    }
}

function abortHttpRequest(options: HttpClientOptions) {
    const ac = options.outAbort;
    if (ac) {
        ac.abort();
        delete options.outAbort;
        return true;
    }
    return false;
}

function warnProtocol(this: IModule, host: HttpHostData, err: Error) {
    if (host.v2()) {
        this.formatMessage(this.logType.SYSTEM, 'HTTP' + host.version, ['Unsupported protocol', host.authority], err, { titleColor: 'white', titleBgColor: 'bgGray' });
    }
}

function downloadFail(this: IModule, uri: string, err: Error) {
    this.writeFail(['Unable to download file', uri], err);
}

function retryRequest(value: number) {
    switch (value) {
        case HTTP_STATUS.REQUEST_TIMEOUT:
        case HTTP_STATUS.TOO_MANY_REQUESTS:
        case HTTP_STATUS.CONNECTION_CLOSED_WITHOUT_RESPONSE:
        case HTTP_STATUS.CLIENT_CLOSED_REQUEST:
        case HTTP_STATUS.INTERNAL_SERVER_ERROR:
        case HTTP_STATUS.BAD_GATEWAY:
        case HTTP_STATUS.SERVICE_UNAVAILABLE:
        case HTTP_STATUS.GATEWAY_TIMEOUT:
        case HTTP_STATUS.NETWORK_CONNECT_TIMEOUT_ERROR:
            return true;
        default:
            return false;
    }
}

const invalidRequest = (value: number) => value >= HTTP_STATUS.UNAUTHORIZED && value <= HTTP_STATUS.NOT_FOUND;
const downgradeVersion = (value: number) => value === HTTP_STATUS.MISDIRECTED_REQUEST || value === HTTP_STATUS.HTTP_VERSION_NOT_SUPPORTED;
const fromNgFlags = (value: number, statusCode: number, location?: string) => location ? new Error(`Using HTTP 1.1 for URL redirect (${location})`) : fromStatusCode(statusCode, value ? 'NGHTTP2 Error ' + value : '');
const fromStatusCode = (value: NumString, hint?: string) => new Error(value + ': ' + httpStatus.getReasonPhrase(value) + (hint ? ` (${hint})` : ''));
const checkHostFail = (host: HttpHostData) => host.success[0] === 0 || host.failed[0] >= HTTP2.MAX_FAILED;
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

    static formatSize(value: NumString, options?: bytes.BytesOptions): NumString {
        return Module.isString(value) ? bytes(value) : bytes(value, options);
    }

    static resetHttpHost(version = 0) {
        switch (version) {
            case 0:
                for (const authority in HTTP_HOST) {
                    delete HTTP_HOST[authority];
                }
                break;
            case 1:
                for (const authority in HTTP_HOST) {
                    HTTP_HOST[authority]!.version = 1;
                }
                break;
            case 2: {
                for (const authority in HTTP_HOST) {
                    const host = HTTP_HOST[authority]!;
                    const failed = host.failed[0];
                    if (!failed || host.success[0] && failed < HTTP2.MAX_FAILED) {
                        host.version = version;
                    }
                }
                break;
            }
        }
    }

    static getHttpBufferSize() {
        let result = 0;
        for (const uri in HTTP_BUFFER) {
            result += Buffer.byteLength(HTTP_BUFFER[uri]![1]);
        }
        return result;
    }

    static clearHttpBuffer(percent = 1) {
        if (percent >= 1 || isNaN(percent)) {
            for (const uri in HTTP_BUFFER) {
                delete HTTP_BUFFER[uri];
            }
        }
        else if (percent > 0) {
            const bufferSize = Math.ceil(this.getHttpBufferSize() * percent);
            let purgeSize = 0;
            for (const uri in HTTP_BUFFER) {
                purgeSize += Buffer.byteLength(HTTP_BUFFER[uri]![1]);
                delete HTTP_BUFFER[uri];
                if (purgeSize >= bufferSize) {
                    break;
                }
            }
        }
    }

    static settingsHttpRetry(limit: Undef<NumString>, delay: Undef<NumString>) {
        if (limit && !isNaN(limit = +limit) && limit >= 0) {
            HTTP_RETRYLIMIT = limit;
        }
        if (delay && !isNaN(delay = +delay) && delay >= 0) {
            HTTP_RETRYDELAY = delay;
        }
    }

    moduleName = 'filemanager';
    delayed = 0;
    useAcceptEncoding = false;
    keepAliveTimeout = 0;
    cacheHttpRequest = false;
    cacheHttpRequestBuffer: HttpRequestBuffer = { expires: 0, limit: Infinity };
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
    readonly subProcesses = new Set<IModule>();
    readonly emptyDir = new Set<string>();
    readonly postFinalize: Null<PostFinalizeCallback> = null;

    private _cleared = false;
    private _httpVersion: HttpVersionSupport = 1;
    private _sessionHttp2: ObjectMap<http2.ClientHttp2Session> = {};

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

    install(name: string, ...params: unknown[]): any {
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
                    instance.host = this;
                    this.Task.push({ instance, constructor: target, params });
                    return instance;
                }
                break;
            case 'cloud':
                if (Module.isObject<CloudModule>(target)) {
                    const instance = new Cloud(target, this.dataSourceItems.filter(item => item.source === 'cloud') as Undef<CloudDatabase[]>);
                    instance.host = this;
                    return this.Cloud = instance;
                }
                break;
            case 'watch': {
                const [port, securePort] = params;
                const instance = new Watch(
                    typeof target === 'number' && target > 0 ? target : undefined,
                    typeof port === 'number' && port > 0 ? port : undefined,
                    typeof securePort === 'number' && securePort > 0 ? securePort : undefined
                );
                instance.host = this;
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
                        manager.install('compress');
                    }
                    manager.permission = this.permission;
                    manager.httpVersion = this.httpVersion;
                    manager.keepAliveTimeout = this.keepAliveTimeout;
                    manager.cacheHttpRequest = this.cacheHttpRequest;
                    manager.cacheHttpRequestBuffer = this.cacheHttpRequestBuffer;
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
    add(value: unknown, parent?: ExternalAsset) {
        if (Module.isString(value)) {
            this.files.add(this.removeCwd(value));
            if (parent) {
                const transforms = parent.transforms ||= [];
                if (!transforms.includes(value)) {
                    transforms.push(value);
                }
            }
        }
    }
    delete(value: unknown, emptyDir = true) {
        if (Module.isString(value)) {
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
    }
    has(value: unknown): value is string {
        return Module.isString(value) && this.files.has(this.removeCwd(value));
    }
    removeCwd(value: unknown) {
        return Module.isString(value) ? value.substring(this.baseDirectory.length + 1) : '';
    }
    findAsset(value: unknown, instance?: IModule) {
        if (Module.isString(value)) {
            value = Module.toPosix(value);
            return this.assets.find(item => Module.toPosix(item.uri) === value && (!instance || this.hasDocument(instance, item.document)));
        }
    }
    removeAsset(file: ExternalAsset) {
        this.filesToRemove.add(file.localUri!);
    }
    replace(file: ExternalAsset, replaceWith: string, mimeType?: string) {
        const localUri = file.localUri;
        if (localUri) {
            if (replaceWith.indexOf('__copy__') !== -1 && path.extname(localUri) === path.extname(replaceWith)) {
                try {
                    fs.renameSync(replaceWith, localUri);
                }
                catch (err) {
                    this.writeFail(['Unable to rename file', replaceWith], err, this.logType.FILE);
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
    completeAsyncTask(err?: Null<Error>, localUri = '', parent?: ExternalAsset) {
        if (this.delayed !== Infinity) {
            if (!err && localUri) {
                this.add(localUri, parent);
            }
            this.removeAsyncTask();
            this.performFinalize();
        }
        if (err) {
            this.writeFail(['Unknown', localUri], err, this.logType.FILE);
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
                    const errors: string[] = [];
                    const addErrors = (instance: IModule) => {
                        const items = instance.errors;
                        const length = items.length;
                        if (length) {
                            const moduleName = instance.moduleName;
                            for (let i = 0; i < length; ++i) {
                                errors.push(`[${moduleName}] ` + items[i]);
                            }
                            items.length = 0;
                        }
                    };
                    addErrors(this);
                    for (const { instance } of this.Document) {
                        addErrors(instance);
                    }
                    for (const { instance } of this.Task) {
                        addErrors(instance);
                    }
                    if (this.Cloud) {
                        addErrors(this.Cloud);
                    }
                    if (this.Watch) {
                        addErrors(this.Watch);
                    }
                    this.subProcesses.forEach(instance => addErrors(instance));
                    this.postFinalize(files.map(name => ({ name, size: bytes(Module.getFileSize(path.join(this.baseDirectory, name))) } as FileInfo)), errors);
                }
                const sessionHttp2 = this._sessionHttp2;
                for (const name in sessionHttp2) {
                    sessionHttp2[name]!.close();
                }
                this.assets.forEach(item => {
                    if (item.buffer) {
                        delete item.buffer;
                    }
                    if (item.sourceUTF8) {
                        delete item.sourceUTF8;
                    }
                });
            });
        }
    }
    hasDocument(instance: IModule, document: Undef<StringOfArray>) {
        const moduleName = instance.moduleName;
        return !!moduleName && (document === moduleName || Array.isArray(document) && document.includes(moduleName));
    }
    setLocalUri(file: ExternalAsset) {
        const uri = file.uri;
        if (uri && !(file.uri = Module.resolveUri(uri))) {
            file.invalid = true;
            this.writeFail(['Unable to parse file:// protocol', uri], new Error('Path not absolute'));
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
                    this.writeFail(['Unable to read file', localUri], err, this.logType.FILE);
                }
            }
        }
        return file.sourceUTF8 || '';
    }
    setAssetContent(file: ExternalAsset, localUri: string, content: string, index = 0, replacePattern?: string) {
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
                        if (Module.isString(content)) {
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
                this.writeFail(['Unable to write file', file.localUri!], err, this.logType.FILE);
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
                    this.writeFail(['Unable to copy file', localUri], err, this.logType.FILE);
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
            this.writeFail(['Unable to read buffer', localUri], err);
        }
        if (rename) {
            if (!ext) {
                file.invalid = true;
            }
            else {
                const output = Image.renameExt(localUri, ext);
                if (localUri !== output) {
                    try {
                        fs.renameSync(localUri, output);
                        this.replace(data.file, output, mimeType);
                    }
                    catch (err) {
                        this.writeFail(['Unable to rename file', output], err, this.logType.FILE);
                    }
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
                        valid = this.supported(11, 7) || this.supported(10, 16, 0, true);
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
                try {
                    if (overwrite || !fs.existsSync(output) || fs.statSync(output).mtimeMs < this.startTime) {
                        tasks.push(
                            new Promise<void>(resolve => {
                                const complete = (err?: Null<Error>) => {
                                    if (err) {
                                        this.writeFail(['Unable to compress file', localUri], err);
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
                                                    if (!Module.isErrorCode(err_1, 'ENOENT')) {
                                                        this.writeFail(['Unable to delete file', result], err_1, this.logType.FILE);
                                                    }
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
                catch (err) {
                    this.writeFail(['Unable to read file', output], err, this.logType.FILE);
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
        let mimeType = file.mimeType;
        if (this.Image) {
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
        if (file.document && (!mimeType || !mimeType.startsWith('image/'))) {
            for (const { instance, constructor } of this.Document) {
                if (this.hasDocument(instance, file.document)) {
                    await constructor.using.call(this, instance, file);
                }
            }
        }
        if (file.invalid) {
            try {
                if (localUri && !file.bundleId && fs.existsSync(localUri)) {
                    fs.unlinkSync(localUri);
                }
            }
            catch (err) {
                if (!Module.isErrorCode(err, 'ENOENT')) {
                    this.writeFail(['Unable to delete file', localUri], err, this.logType.FILE);
                }
            }
            this.completeAsyncTask();
        }
        else {
            this.completeAsyncTask(null, localUri, parent);
        }
    }
    getHttpHost(uri: string): HttpHostRequest {
        const url = new URL(uri);
        const authority = url.origin;
        const credentials = url.username + (url.password ? ':' + url.password : '');
        const key = authority + credentials;
        let host = HTTP_HOST[key];
        if (!host) {
            const protocol = url.protocol;
            const secure = protocol === 'https:';
            const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
            let headers: Undef<OutgoingHttpHeaders>;
            if (credentials) {
                headers = { authorization: 'Basic ' + Buffer.from(credentials, 'base64') };
            }
            host = Object.create({
                authority,
                credentials,
                version: secure ? this.httpVersion : 1,
                protocol,
                secure,
                localhost,
                success: [0],
                failed: [0],
                headers,
                "v2": function(this: HttpHostData) { return this.version === 2; }
            }) as HttpHostData;
            HTTP_HOST[key] = host;
        }
        return { host, url };
    }
    getHttpClient(uri: string, options?: HttpClientOptions) {
        let host: Undef<HttpHostData>,
            url: Undef<URL>,
            method: Undef<string>,
            httpVersion: Undef<HttpVersionSupport>,
            headers: Undef<OutgoingHttpHeaders>,
            localStream: Undef<fs.WriteStream>,
            timeout: Undef<number>;
        if (options) {
            ({ host, url, method, httpVersion, headers, localStream, timeout } = options);
        }
        if (!host) {
            ({ host, url } = this.getHttpHost(uri));
            if (options) {
                options.host = host;
                options.url = url;
            }
        }
        else if (!url) {
            url = new URL(uri);
            if (options) {
                options.url = url;
            }
        }
        if (httpVersion && host.version !== httpVersion) {
            if (options) {
                host = { ...host };
                options.host = host;
            }
            else {
                HTTP_HOST[host.authority + host.credentials] = { ...host };
            }
            host.version = httpVersion;
        }
        method ||= 'GET';
        const getting = method === 'GET';
        if (getting && !host.localhost) {
            if (this.useAcceptEncoding) {
                (headers ||= {})['accept-encoding'] ||= 'gzip, deflate' + (HTTP_BROTLISUPPORT ? ', br' : '');
            }
        }
        if (host.headers) {
            headers = headers ? { ...host.headers, ...headers } : host.headers;
        }
        const pathname = url.pathname + url.search;
        const checkEncoding = (res: IncomingMessage | ClientHttp2Stream, encoding = ''): Undef<Transform> => {
            switch (encoding.trim().toLowerCase()) {
                case 'gzip':
                    return res.pipe(zlib.createGunzip());
                case 'br':
                    if (HTTP_BROTLISUPPORT) {
                        return res.pipe(zlib.createBrotliDecompress());
                    }

                        res.destroy(new Error('Unable to decompress Brotli encoding'));

                case 'deflate':
                    return res.pipe(zlib.createInflate());
            }
        };
        if (host.v2()) {
            let signal: Undef<AbortSignal>;
            if (options && this.supported(15, 4)) {
                const ac = new AbortController();
                signal = ac.signal;
                options.outAbort = ac;
            }
            const request = (this._sessionHttp2[host.authority] ||= http2.connect(host.authority)).request({ ...headers, ':path': pathname, ':method': method }, signal && { signal } as PlainObject);
            request.on('response', res => {
                if (getting && (res[':status'] || 0) < HTTP_STATUS.MULTIPLE_CHOICES) {
                    let compressStream: Undef<Transform>;
                    if (this.useAcceptEncoding && (compressStream = checkEncoding(request, res['content-encoding']))) {
                        if (localStream) {
                            compressStream.pipe(localStream);
                            compressStream.once('finish', () => {
                                localStream!
                                    .on('finish', function(this: Transform) { this.destroy(); })
                                    .emit('finish');
                            });
                            localStream.on('error', err => request.emit('error', err));
                        }
                        else {
                            const addListener = request.on.bind(request);
                            request.on = function(this: ClientHttp2Stream, event: string, listener: (...args: any[]) => void) {
                                switch (event) {
                                    case 'data':
                                    case 'close':
                                    case 'error':
                                        compressStream!.on(event, listener);
                                        break;
                                    case 'end':
                                        compressStream!.on('finish', listener);
                                        break;
                                    default:
                                        addListener(event, listener);
                                        break;
                                }
                                return this;
                            };
                        }
                    }
                    else if (localStream && !request.destroyed) {
                        request.pipe(localStream);
                    }
                }
            });
            request.end();
            return request;
        }
        timeout ??= this.keepAliveTimeout;
        const request = (host.secure ? https : http).request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || (host.secure ? '443' : '80'),
            path: pathname,
            method,
            headers,
            agent: timeout > 0 ? new (host.secure ? https.Agent : http.Agent)({ keepAlive: true, timeout }) : false
        }, res => {
            let outputStream: Undef<IncomingMessage | Transform>;
            if (getting) {
                outputStream = checkEncoding(res, res.headers['content-encoding']);
                if (res.destroyed) {
                    return;
                }
            }
            if (outputStream ||= res) {
                outputStream.on('data', chunk => request.emit('data', chunk));
                outputStream.on('error', err => request.emit('error', err));
                outputStream.on('close', () => request.emit('close'));
                outputStream.once('end', () => request.emit('end'));
                if (localStream) {
                    stream.pipeline(outputStream, localStream, err => {
                        if (err) {
                            request.emit('error', err);
                        }
                    });
                }
            }
        });
        request.end();
        return request;
    }
    fetchBuffer(uri: string, options?: FetchBufferOptions) {
        return new Promise<Null<Buffer>>(resolve => {
            try {
                const server = this.getHttpHost(uri) as Required<HttpClientOptions>;
                const httpVersion = options && options.httpVersion;
                if (httpVersion) {
                    server.httpVersion = httpVersion;
                }
                const client = this.getHttpClient(uri, server);
                const host = server.host;
                let retries = 0;
                const downloadUri = () => {
                    let buffer: Null<Buffer> = null;
                    if (host.v2()) {
                        let retrying: Undef<boolean>,
                            aborted: Undef<boolean>;
                        const retryDownload = async (downgrade: boolean, err?: Error) => {
                            if (err) {
                                warnProtocol.call(this, host, err);
                            }
                            if (!retrying) {
                                aborted = abortHttpRequest(server);
                                retrying = true;
                                buffer = null;
                                if (downgrade) {
                                    downgradeHost(host);
                                    resolve(await this.fetchBuffer(uri));
                                }
                                else {
                                    resolve(await this.fetchBuffer(uri, { httpVersion: 1 }));
                                }
                            }
                            (client as ClientHttp2Stream).close();
                        };
                        (client as ClientHttp2Stream)
                            .on('response', (headers, flags) => {
                                if (!retrying) {
                                    const statusCode = headers[':status']!;
                                    if (invalidRequest(statusCode)) {
                                        resolve(null);
                                    }
                                    else if (retryRequest(statusCode) && ++retries <= HTTP_RETRYLIMIT) {
                                        setTimeout(() => downloadUri(), HTTP_RETRYDELAY);
                                    }
                                    else if (downgradeVersion(statusCode)) {
                                        retryDownload(true, fromNgFlags(http2.constants.NGHTTP2_PROTOCOL_ERROR, HTTP_STATUS.HTTP_VERSION_NOT_SUPPORTED));
                                    }
                                    else if (statusCode >= HTTP_STATUS.BAD_REQUEST) {
                                        if (HTTP2_UNSUPPORTED.includes(flags)) {
                                            retryDownload(checkHostFail(host), fromNgFlags(flags, statusCode));
                                        }
                                        else {
                                            retryDownload(false);
                                        }
                                    }
                                    else if (statusCode >= HTTP_STATUS.MULTIPLE_CHOICES) {
                                        ++retries;
                                        retryDownload(false, fromNgFlags(0, statusCode, headers.location));
                                    }
                                    else {
                                        client.on('end', () => {
                                            if (!retrying) {
                                                if (buffer) {
                                                    host.success[0]++;
                                                }
                                                resolve(buffer);
                                            }
                                        });
                                    }
                                }
                            })
                            .on('error', err => {
                                if (!retrying && !aborted) {
                                    retryDownload(true, err);
                                }
                            });
                    }
                    else {
                        (client as ClientRequest)
                            .on('response', res => {
                                const statusCode = res.statusCode!;
                                if (retryRequest(statusCode) && ++retries <= HTTP_RETRYLIMIT) {
                                    setTimeout(() => downloadUri(), HTTP_RETRYDELAY);
                                }
                                else if (statusCode >= HTTP_STATUS.MULTIPLE_CHOICES) {
                                    resolve(null);
                                }
                                else {
                                    res.on('end', () => resolve(buffer));
                                }
                            })
                            .on('error', err => downloadFail.call(this, uri, err));
                    }
                    client.on('data', data => {
                        if (Buffer.isBuffer(data)) {
                            buffer = buffer ? Buffer.concat([buffer, data]) : data;
                        }
                    });
                };
                downloadUri();
            }
            catch (err) {
                this.writeFail(['Unable to fetch bufffer', uri], err);
                resolve(null);
            }
        });
    }
    processAssets(emptyDir?: boolean) {
        const processing: ObjectMap<ExternalAsset[]> = {};
        const downloading: ObjectMap<ExternalAsset[]> = {};
        const appending: ObjectMap<ExternalAsset[]> = {};
        const completed: string[] = [];
        const emptied: string[] = [];
        const notFound: string[] = [];
        const { expires: bufferExpires, limit: bufferLimit } = this.cacheHttpRequestBuffer;
        const isCacheable = (file: ExternalAsset) => bufferLimit > 0 && (!file.contentLength || file.contentLength <= bufferLimit);
        const permissionFail = (file: ExternalAsset) => {
            const uri = file.uri!;
            this.writeFail(['Unable to read file', uri], new Error(`Insufficient permissions (${uri})`));
            file.invalid = true;
        };
        const setHeaderData = (file: ExternalAsset, headers: IncomingHttpHeaders, lastModified?: boolean) => {
            let length: Undef<NumString> = headers['content-length'];
            if (length && !isNaN(length = parseInt(length))) {
                file.contentLength = length;
            }
            let etag = headers.etag;
            if (etag) {
                file.etag = etag;
            }
            else if (lastModified && this.Watch) {
                etag = headers['last-modified'];
                file.etag = etag;
            }
            return etag;
        };
        const clearTempBuffer = (uri: string, tempUri?: string) => {
            if (tempUri) {
                try {
                    fs.unlinkSync(tempUri);
                    fs.rmdirSync(path.dirname(tempUri));
                }
                catch {
                }
            }
            if (uri in HTTP_BUFFER) {
                delete HTTP_BUFFER[uri];
            }
        };
        const setTempBuffer = (file: ExternalAsset, uri: string, etag: string, buffer: Buffer, tempUri?: string) => {
            const contentLength = file.contentLength || Buffer.byteLength(buffer);
            if (contentLength <= bufferLimit) {
                HTTP_BUFFER[uri] = [etag, buffer];
                if (bufferExpires < Infinity) {
                    setTimeout(() => clearTempBuffer(uri, tempUri), bufferExpires);
                }
            }
            else {
                clearTempBuffer(uri, tempUri);
            }
        };
        const createTempDir = (url: URL) => {
            if (this.cacheHttpRequest) {
                const tempDir = this.getTempDir(false, url.hostname + (url.port ? '_' + url.port : ''));
                try {
                    fs.mkdirpSync(tempDir);
                    return tempDir;
                }
                catch (err) {
                    this.writeFail(['Unable to create directory', tempDir], err, this.logType.FILE);
                }
            }
        };
        const checkQueue = (file: ExternalAsset, localUri: string, content?: boolean) => {
            const bundleIndex = file.bundleIndex!;
            if (bundleIndex >= 0) {
                const items = appending[localUri] ||= [];
                if (bundleIndex > 0) {
                    items[bundleIndex - 1] = file;
                    if ((this.cacheHttpRequest || bufferLimit > 0) && !file.content) {
                        const { uri, bundleId } = file;
                        const parent = this.assets.find(item => item.bundleIndex === 0 && item.bundleId === bundleId);
                        if (parent) {
                            (parent.bundleQueue ||= []).push(
                                new Promise<ExternalAsset>(resolve => {
                                    (this.getHttpClient(uri!, { method: 'HEAD', httpVersion: 1 }) as ClientRequest)
                                        .on('response', res => {
                                            const statusCode = res.statusCode!;
                                            if (statusCode >= 400) {
                                                file.invalid = true;
                                                downloadFail.call(this, uri!, fromStatusCode(statusCode));
                                            }
                                            else {
                                                setHeaderData(file, res.headers);
                                            }
                                        })
                                        .on('end', () => resolve(file))
                                        .on('error', err => {
                                            file.invalid = true;
                                            downloadFail.call(this, uri!, err);
                                        });
                                })
                            );
                        }
                    }
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
        const processQueue = async (file: ExternalAsset, localUri: string) => {
            completed.push(localUri);
            if (file.bundleIndex === 0) {
                file.sourceUTF8 = this.setAssetContent(file, localUri, this.getUTF8String(file, localUri));
                if (file.bundleQueue) {
                    await Promise.all(file.bundleQueue);
                }
                const items = appending[localUri];
                if (items) {
                    const tasks: Promise<void>[] = [];
                    const verifyBundle = (next: ExternalAsset, value: string | Null<Buffer>, etag?: string) => {
                        if (!next.invalid) {
                            if (value) {
                                if (value instanceof Buffer) {
                                    if (etag) {
                                        setTempBuffer(next, next.uri!, encodeURIComponent(etag), value);
                                    }
                                    value = value.toString('utf8');
                                }
                                this.setAssetContent(next, localUri, value, next.bundleIndex, next.bundleReplace);
                            }
                            else {
                                next.invalid = true;
                            }
                        }
                    };
                    for (const queue of items) {
                        if (!queue.invalid) {
                            const { uri, content } = queue;
                            if (content) {
                                verifyBundle(queue, content);
                            }
                            else if (uri) {
                                if (Module.isFileHTTP(uri)) {
                                    tasks.push(new Promise<void>((resolve, reject) => {
                                        try {
                                            const options = this.getHttpHost(uri) as Required<HttpClientOptions>;
                                            let etag = queue.etag,
                                                baseDir: Undef<string>,
                                                tempDir: Undef<string>,
                                                etagDir: Undef<string>,
                                                tempUri: Undef<string>;
                                            if (etag) {
                                                tempDir = createTempDir(options.url);
                                                etagDir = encodeURIComponent(etag);
                                                const cached = HTTP_BUFFER[uri];
                                                if (cached) {
                                                    if (etagDir === cached[0]) {
                                                        verifyBundle(queue, cached[1].toString('utf8'));
                                                        resolve();
                                                        return;
                                                    }
                                                    clearTempBuffer(uri, tempDir && path.join(tempDir, cached[0], path.basename(localUri)));
                                                }
                                                if (tempDir) {
                                                    tempUri = path.join(baseDir = path.join(tempDir, etagDir), path.basename(localUri));
                                                    try {
                                                        if (Module.hasSize(tempUri)) {
                                                            verifyBundle(queue, fs.readFileSync(tempUri), etag);
                                                            resolve();
                                                            return;
                                                        }
                                                        else if (!fs.pathExistsSync(baseDir)) {
                                                            fs.mkdirSync(baseDir);
                                                        }
                                                    }
                                                    catch {
                                                        tempUri = undefined;
                                                    }
                                                }
                                            }
                                            let buffer: Null<Buffer> = null,
                                                retries = 0,
                                                localStream: Null<fs.WriteStream> = null;
                                            const errorRequest = (err: Error) => {
                                                if (!notFound.includes(uri)) {
                                                    notFound.push(uri);
                                                    downloadFail.call(this, uri, err);
                                                }
                                                closeStream();
                                                queue.invalid = true;
                                                resolve();
                                            };
                                            const closeStream = () => {
                                                if (localStream) {
                                                    localStream.destroy();
                                                    clearTempBuffer(uri, tempUri);
                                                    localStream = null;
                                                }
                                            };
                                            const downloadUri = (httpVersion?: HttpVersionSupport) => {
                                                if (tempUri) {
                                                    localStream = fs.createWriteStream(tempUri);
                                                    options.localStream = localStream;
                                                }
                                                if (httpVersion) {
                                                    options.httpVersion = httpVersion;
                                                }
                                                const client = this.getHttpClient(uri, options);
                                                const host = options.host;
                                                let retrying: Undef<boolean>,
                                                    aborted: Undef<boolean>;
                                                const retryDownload = (downgrade: boolean, err?: Error) => {
                                                    closeStream();
                                                    if (err) {
                                                        warnProtocol.call(this, host, err);
                                                    }
                                                    if (!retrying) {
                                                        aborted = abortHttpRequest(options);
                                                        retrying = true;
                                                        buffer = null;
                                                        if (downgrade) {
                                                            downgradeHost(host);
                                                            downloadUri();
                                                        }
                                                        else {
                                                            downloadUri(1);
                                                        }
                                                    }
                                                    (client as ClientHttp2Stream).close();
                                                };
                                                const checkResponse = (statusCode: number, headers: IncomingHttpHeaders) => {
                                                    if (statusCode >= HTTP_STATUS.MULTIPLE_CHOICES) {
                                                        if (host.v2()) {
                                                            ++retries;
                                                            retryDownload(false, fromNgFlags(0, statusCode, headers.location));
                                                        }
                                                        else if (retryRequest(statusCode) && ++retries <= HTTP_RETRYLIMIT) {
                                                            setTimeout(() => downloadUri(), HTTP_RETRYDELAY);
                                                        }
                                                        else {
                                                            errorRequest(fromStatusCode(statusCode));
                                                        }
                                                    }
                                                    else {
                                                        etag = setHeaderData(queue, headers, true);
                                                        client
                                                            .on('data', data => {
                                                                if (Buffer.isBuffer(data)) {
                                                                    buffer = buffer ? Buffer.concat([buffer, data]) : data;
                                                                }
                                                            })
                                                            .on('end', () => {
                                                                if (!retrying && !aborted) {
                                                                    if (host.v2() && buffer) {
                                                                        host.success[0]++;
                                                                    }
                                                                    verifyBundle(queue, buffer, etag);
                                                                    resolve();
                                                                }
                                                            });
                                                    }
                                                };
                                                if (host.v2()) {
                                                    (client as ClientHttp2Stream)
                                                        .on('response', (headers, flags) => {
                                                            if (!retrying) {
                                                                const statusCode = headers[':status']!;
                                                                if (invalidRequest(statusCode)) {
                                                                    aborted = true;
                                                                    resolve();
                                                                }
                                                                else if (downgradeVersion(statusCode)) {
                                                                    retryDownload(true, fromNgFlags(http2.constants.NGHTTP2_PROTOCOL_ERROR, HTTP_STATUS.HTTP_VERSION_NOT_SUPPORTED));
                                                                }
                                                                else if (statusCode >= HTTP_STATUS.BAD_REQUEST) {
                                                                    if (HTTP2_UNSUPPORTED.includes(flags)) {
                                                                        retryDownload(checkHostFail(host), fromNgFlags(flags, statusCode));
                                                                    }
                                                                    else {
                                                                        ++retries;
                                                                        retryDownload(false);
                                                                    }
                                                                }
                                                                else {
                                                                    checkResponse(statusCode, headers);
                                                                }
                                                            }
                                                        })
                                                        .on('error', err => {
                                                            if (!retrying && !aborted) {
                                                                retryDownload(true, err);
                                                            }
                                                        });
                                                }
                                                else {
                                                    (client as ClientRequest)
                                                        .on('response', res => checkResponse(res.statusCode!, res.headers))
                                                        .on('error', err => errorRequest(err));
                                                }
                                            };
                                            downloadUri();
                                        }
                                        catch (err) {
                                            reject(err);
                                        }
                                    }));
                                }
                                else if (Module.isFileUNC(uri) && this.permission.hasUNCRead(uri) || path.isAbsolute(uri) && this.permission.hasDiskRead(uri)) {
                                    tasks.push(new Promise<void>(resolve => {
                                        fs.readFile(uri, 'utf8', (err, data) => {
                                            if (!err) {
                                                verifyBundle(queue, data);
                                            }
                                            else {
                                                this.writeFail(['Unable to read file', uri], err, this.logType.FILE);
                                                queue.invalid = true;
                                            }
                                            resolve();
                                        });
                                    }));
                                }
                                else {
                                    permissionFail(file);
                                }
                            }
                        }
                    }
                    if (tasks.length) {
                        await Module.allSettled(tasks, { rejected: ['Unable to download file', 'bundle: ' + path.basename(localUri)], errors: this.errors });
                    }
                }
                this.transformAsset({ file });
                delete appending[localUri];
            }
            else {
                const uri = file.uri!;
                const processed = processing[localUri];
                const downloaded = downloading[uri];
                if (downloaded && downloaded.length) {
                    const files: string[] = [];
                    const uriMap = new Map<string, ExternalAsset[]>();
                    for (const item of downloaded) {
                        const copyUri = item.localUri!;
                        const items = uriMap.get(copyUri) || [];
                        if (items.length === 0) {
                            const pathname = path.dirname(copyUri);
                            try {
                                fs.mkdirpSync(pathname);
                            }
                            catch (err) {
                                this.writeFail(['Unable to create directory', pathname], err, this.logType.FILE);
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
                            this.writeFail(['Unable to copy file', localUri], err, this.logType.FILE);
                        }
                    }
                }
                if (processed) {
                    for (const item of processed) {
                        if (item !== file) {
                            this.performAsyncTask();
                        }
                        this.transformAsset({ file: item });
                    }
                    delete processing[localUri];
                }
                else {
                    this.transformAsset({ file });
                }
                delete downloading[uri];
            }
        };
        const errorRequest = (file: ExternalAsset, err: Error, outputStream?: Null<fs.WriteStream>) => {
            const { uri, localUri } = file as Required<ExternalAsset>;
            const clearQueue = (data: ObjectMap<ExternalAsset<unknown>[]>, attr: string) => {
                if (data[attr]) {
                    data[attr]!.forEach(item => item.invalid = true);
                    delete data[attr];
                }
            };
            clearQueue(processing, localUri);
            clearQueue(appending, localUri);
            clearQueue(downloading, uri);
            file.invalid = true;
            if (!notFound.includes(uri)) {
                notFound.push(uri);
                this.completeAsyncTask();
            }
            downloadFail.call(this, uri, err);
            if (outputStream) {
                try {
                    outputStream.destroy();
                    if (fs.existsSync(localUri)) {
                        fs.unlinkSync(localUri);
                    }
                }
                catch (err_1) {
                    if (!Module.isErrorCode(err_1, 'ENOENT')) {
                        this.writeFail(['Unable to delete file', localUri], err_1, this.logType.FILE);
                    }
                }
            }
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
                            this.writeFail(['Unable to empty sub directory', pathname], err);
                        }
                    }
                    try {
                        fs.mkdirpSync(pathname);
                        emptied.push(pathname);
                    }
                    catch (err) {
                        this.writeFail(['Unable to create directory', pathname], err, this.logType.FILE);
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
                            }
                            else if (createFolder()) {
                                const options = this.getHttpHost(uri) as Required<HttpClientOptions>;
                                const tempDir = createTempDir(options.url);
                                let retries = 0;
                                const downloadUri = (etagDir?: string, httpVersion?: HttpVersionSupport) => {
                                    let retrying: Undef<boolean>,
                                        aborted: Undef<boolean>,
                                        localStream: Null<fs.WriteStream> = fs.createWriteStream(localUri);
                                    options.localStream = localStream;
                                    if (httpVersion) {
                                        options.httpVersion = httpVersion;
                                    }
                                    const client = this.getHttpClient(uri, options);
                                    const host = options.host;
                                    const retryDownload = (downgrade: boolean, err?: Error) => {
                                        if (localStream) {
                                            try {
                                                localStream.destroy();
                                                localStream = null;
                                                fs.unlinkSync(localUri);
                                            }
                                            catch {
                                            }
                                        }
                                        if (err) {
                                            warnProtocol.call(this, host, err);
                                        }
                                        if (!retrying) {
                                            aborted = abortHttpRequest(options);
                                            retrying = true;
                                            delete item.buffer;
                                            if (downgrade) {
                                                downgradeHost(host);
                                                downloadUri(etagDir);
                                            }
                                            else {
                                                downloadUri(etagDir, 1);
                                            }
                                        }
                                        (client as ClientHttp2Stream).close();
                                    };
                                    const checkResponse = (statusCode: number, headers: IncomingHttpHeaders) => {
                                        if (statusCode >= HTTP_STATUS.MULTIPLE_CHOICES) {
                                            if (host.v2()) {
                                                ++retries;
                                                retryDownload(false, fromNgFlags(0, statusCode, headers.location));
                                            }
                                            else if (retryRequest(statusCode) && ++retries <= HTTP_RETRYLIMIT) {
                                                setTimeout(() => downloadUri(), HTTP_RETRYDELAY);
                                            }
                                            else {
                                                errorRequest(item, fromStatusCode(statusCode), localStream);
                                            }
                                        }
                                        else {
                                            setHeaderData(item, headers, true);
                                            if (item.willChange || isCacheable(item)) {
                                                client.on('data', data => {
                                                    if (Buffer.isBuffer(data)) {
                                                        item.buffer = item.buffer ? Buffer.concat([item.buffer, data]) : data;
                                                    }
                                                });
                                            }
                                        }
                                    };
                                    if (host.v2()) {
                                        (client as ClientHttp2Stream)
                                            .on('response', (headers, flags) => {
                                                if (!retrying) {
                                                    const statusCode = headers[':status']!;
                                                    if (invalidRequest(statusCode)) {
                                                        aborted = true;
                                                        errorRequest(item, fromStatusCode(statusCode), localStream);
                                                    }
                                                    else if (downgradeVersion(statusCode)) {
                                                        retryDownload(true, fromNgFlags(http2.constants.NGHTTP2_PROTOCOL_ERROR, HTTP_STATUS.HTTP_VERSION_NOT_SUPPORTED));
                                                    }
                                                    else if (statusCode >= HTTP_STATUS.BAD_REQUEST) {
                                                        if (HTTP2_UNSUPPORTED.includes(flags)) {
                                                            retryDownload(checkHostFail(host), fromNgFlags(flags, statusCode));
                                                        }
                                                        else {
                                                            ++retries;
                                                            retryDownload(false);
                                                        }
                                                    }
                                                    else {
                                                        checkResponse(statusCode, headers);
                                                    }
                                                }
                                            })
                                            .on('error', err => {
                                                if (!retrying && !aborted) {
                                                    retryDownload(true, err);
                                                }
                                            });
                                    }
                                    else {
                                        (client as ClientRequest)
                                            .on('response', res => checkResponse(res.statusCode!, res.headers))
                                            .on('error', err => errorRequest(item, err, localStream));
                                    }
                                    localStream.on('finish', () => {
                                        if (!retrying && !aborted && !notFound.includes(uri)) {
                                            if (host.v2()) {
                                                host.success[0]++;
                                            }
                                            processQueue(item, localUri);
                                            if (etagDir) {
                                                const buffer = item.buffer;
                                                if (tempDir) {
                                                    const baseDir = path.join(tempDir, etagDir);
                                                    const tempUri = path.join(baseDir, path.basename(localUri));
                                                    try {
                                                        if (!fs.pathExistsSync(baseDir)) {
                                                            fs.mkdirSync(baseDir);
                                                        }
                                                        if (buffer) {
                                                            if (bufferLimit > 0) {
                                                                setTempBuffer(item, uri, etagDir, buffer, tempUri);
                                                            }
                                                            fs.writeFile(tempUri, buffer);
                                                        }
                                                        else if (fs.statSync(localUri).size > 0) {
                                                            fs.copyFile(localUri, tempUri);
                                                        }
                                                    }
                                                    catch (err) {
                                                        this.writeFail(['Unable to cache file', tempUri], err, this.logType.FILE);
                                                    }
                                                }
                                                else if (bufferLimit > 0 && buffer) {
                                                    setTempBuffer(item, uri, etagDir, buffer);
                                                }
                                            }
                                        }
                                    });
                                };
                                this.performAsyncTask();
                                downloading[uri] = [];
                                (this.getHttpClient(uri, { method: 'HEAD', httpVersion: 1 }) as ClientRequest)
                                    .on('response', res => {
                                        const statusCode = res.statusCode!;
                                        if (statusCode >= HTTP_STATUS.MULTIPLE_CHOICES) {
                                            errorRequest(item, fromStatusCode(statusCode));
                                        }
                                        else {
                                            const etag = setHeaderData(item, res.headers);
                                            let etagDir: Undef<string>;
                                            if (Module.isString(etag)) {
                                                const cached = HTTP_BUFFER[uri];
                                                let buffer: Null<Buffer> = null;
                                                if (cached) {
                                                    const etagCache = cached[0];
                                                    if (etagDir === etagCache) {
                                                        buffer = cached[1];
                                                    }
                                                    else {
                                                        clearTempBuffer(uri, tempDir && path.join(tempDir, etagCache, path.basename(localUri)));
                                                    }
                                                }
                                                const checkBuffer = () => {
                                                    if (buffer) {
                                                        if (item.willChange) {
                                                            item.buffer = buffer;
                                                        }
                                                        fs.writeFileSync(localUri, buffer);
                                                        fileReceived();
                                                        return true;
                                                    }
                                                    return false;
                                                };
                                                try {
                                                    if (tempDir) {
                                                        const tempUri = path.join(tempDir, etagDir = encodeURIComponent(etag), path.basename(localUri));
                                                        if (Module.hasSize(tempUri)) {
                                                            if (!buffer && isCacheable(item)) {
                                                                setTempBuffer(item, uri, etagDir, buffer = fs.readFileSync(tempUri), tempUri);
                                                            }
                                                            if (this.archiving || !Module.hasSameStat(tempUri, localUri)) {
                                                                if (buffer) {
                                                                    fs.writeFileSync(localUri, buffer);
                                                                }
                                                                else {
                                                                    fs.copyFileSync(tempUri, localUri);
                                                                }
                                                            }
                                                            if (buffer && !item.willChange) {
                                                                item.buffer = buffer;
                                                            }
                                                            fileReceived();
                                                            return;
                                                        }
                                                        else if (checkBuffer()) {
                                                            try {
                                                                fs.writeFileSync(tempUri, buffer!);
                                                            }
                                                            catch {
                                                            }
                                                            return;
                                                        }
                                                    }
                                                    else if (checkBuffer()) {
                                                        return;
                                                    }
                                                }
                                                catch {
                                                }
                                            }
                                            downloadUri(etagDir);
                                        }
                                    })
                                    .on('error', err => errorRequest(item, err));
                            }
                        }
                    }
                    else if (Module.isFileUNC(uri) && this.permission.hasUNCRead(uri) || path.isAbsolute(uri) && this.permission.hasDiskRead(uri)) {
                        if (!checkQueue(item, localUri) && createFolder() && (this.archiving || !Module.hasSameStat(uri, localUri))) {
                            this.performAsyncTask();
                            fs.copyFile(uri, localUri, err => fileReceived(err));
                        }
                    }
                    else {
                        permissionFail(item);
                    }
                }
                catch (err) {
                    errorRequest(item, err);
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
                        if (!Module.isErrorCode(err, 'ENOENT')) {
                            this.writeFail(['Unable to delete file', value], err, this.logType.FILE);
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
                                    tasks.push(new Promise<void>(resolve => {
                                        const complete = (err?: Null<Error>) => {
                                            if (err) {
                                                this.writeFail(['Unable to compress image', file], err);
                                            }
                                            resolve();
                                        };
                                        try {
                                            Compress.tryImage(file, image, (err?: Null<Error>, value?: Null<unknown>) => {
                                                if (file === item.localUri) {
                                                    item.buffer = value instanceof Buffer ? value : undefined;
                                                }
                                                complete(err);
                                            }, files.length === 1 ? item.buffer : undefined);
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
            await Module.allSettled(tasks, { rejected: 'Write modified files', errors: this.errors, type: this.logType.FILE });
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
                await Module.allSettled(tasks, { rejected: 'Compress files', errors: this.errors });
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
    get httpVersion() {
        return this._httpVersion;
    }
    set httpVersion(value) {
        switch (value) {
            case 2:
                if (this.supported(10, 10)) {
                    this._httpVersion = 2;
                    break;
                }
            default:
                this._httpVersion = 1;
                break;
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