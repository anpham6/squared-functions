import type { DataSource, FileInfo } from '../types/lib/squared';

import type { DocumentConstructor, ICloud, ICompress, IDocument, IFileManager, IModule, ITask, IWatch, ImageConstructor, TaskConstructor } from '../types/lib';
import type { ExternalAsset, FileData, FileOutput, OutputData } from '../types/lib/asset';
import type { CloudDatabase } from '../types/lib/cloud';
import type { AssetContentOptions, HttpBaseHeaders, HttpRequestBuffer, HttpRequestSettings, InstallData, PostFinalizeCallback } from '../types/lib/filemanager';
import type { HttpProxyData, HttpRequest, HttpRequestClient, HttpVersionSupport, IHttpHost } from '../types/lib/http';
import type { CloudModule, DocumentModule } from '../types/lib/module';
import type { RequestBody } from '../types/lib/node';

import type { WriteStream } from 'fs';
import type { Agent, ClientRequest, IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders } from 'http';
import type { ClientHttp2Stream } from 'http2';
import type { Transform, Writable } from 'stream';

import { ERR_MESSAGE } from '../types/lib/logger';

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

import HttpAgent = require('agentkeepalive');

import Module from '../module';
import Document from '../document';
import Task from '../task';
import Image from '../image';
import Cloud from '../cloud';
import Watch from '../watch';
import Compress from '../compress';

import Permission from './permission';

const { http, https } = followRedirects;
const { HttpsAgent } = HttpAgent;

const enum HTTP { // eslint-disable-line no-shadow
    MAX_FAILED = 5,
    MAX_ERROR = 10,
    CHUNK_SIZE = 4 * 1024,
    CHUNK_SIZE_LOCAL = 64 * 1024
}

export const enum HTTP_STATUS { // eslint-disable-line no-shadow
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

const HTTP_HOST: ObjectMap<IHttpHost> = {};
const HTTP_BASEHEADERS: HttpBaseHeaders = {};
const HTTP_BUFFER: ObjectMap<Null<[string, Buffer]>> = {};
const HTTP_BROTLISUPPORT = Module.supported(11, 7) || Module.supported(10, 16, 0, true);
let HTTP_CONNECTTIMEOUT = 10 * 1000;
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

function downgradeHost(host: IHttpHost) {
    if (host.v2()) {
        host.failed();
        host.version = 1;
    }
}

function abortHttpRequest(client: HttpRequestClient, options: HttpRequest) {
    if (client.destroyed) {
        return true;
    }
    const ac = options.outAbort;
    if (ac) {
        if (!client.aborted) {
            ac.abort();
        }
        delete options.outAbort;
        return true;
    }
    return false;
}

function warnProtocol(this: IModule, host: IHttpHost, err: Error) {
    if (host.v2()) {
        this.formatMessage(this.logType.HTTP, 'HTTP' + host.version, ['Unsupported protocol', host.origin], err, { failed: true });
    }
}

function isRetryStatus(value: number) {
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

function isRetryError(err: unknown) {
    if (err instanceof Error) {
        const { code, errno } = err as SystemError;
        switch (code) {
            case 'ETIMEDOUT':
            case 'ECONNRESET':
            case 'EADDRINUSE':
            case 'ECONNREFUSED':
            case 'EPIPE':
            case 'ENOTFOUND':
            case 'ENETUNREACH':
            case 'EAI_AGAIN':
                return true;
            default:
                return typeof errno === 'number' && isRetryStatus(Math.abs(errno));
        }
    }
    return false;
}

function getBaseHeaders(uri: string) {
    let result: Undef<[string, OutgoingHttpHeaders][]>;
    for (const pathname in HTTP_BASEHEADERS) {
        if (uri.startsWith(pathname)) {
            (result ||= []).push([pathname, HTTP_BASEHEADERS[pathname]!]);
        }
    }
    if (result) {
        if (result.length > 1) {
            result.sort((a, b) => b[0].length - a[0].length);
        }
        return result[0][1];
    }
}

function warnConnectTimeout(this: IModule, request: HttpRequest) {
    this.formatMessage(this.logType.HTTP, 'HTTP' + request.host.version, ['Connection timeout (retrying)', request.host.origin], request.url.toString());
}

export function isConnectionTimeout(err: unknown) {
    switch (err instanceof Error && (err as SystemError).code) {
        case 'ECONNRESET':
        case 'ETIMEDOUT':
            return true;
        default:
            return false;
    }
}

const isDowngrade = (err: unknown) => err instanceof Error && ((err as SystemError).code === 'ERR_HTTP2_ERROR' || Math.abs((err as SystemError).errno) === HTTP_STATUS.HTTP_VERSION_NOT_SUPPORTED);
const isAborted = (host: IHttpHost, client: HttpRequestClient) => client.destroyed || host.v2() && (client as ClientHttp2Stream).aborted;
const invalidRequest = (value: number) => value >= HTTP_STATUS.UNAUTHORIZED && value <= HTTP_STATUS.NOT_FOUND || value === HTTP_STATUS.PROXY_AUTHENTICATION_REQUIRED || value === HTTP_STATUS.GONE;
const downgradeVersion = (value: number) => value === HTTP_STATUS.MISDIRECTED_REQUEST || value === HTTP_STATUS.HTTP_VERSION_NOT_SUPPORTED;
const formatStatusCode = (value: NumString, hint?: string) => new Error(value + ': ' + FileManager.fromHttpStatusCode(value) + (hint ? ` (${hint})` : ''));
const formatNgFlags = (value: number, statusCode: number, location?: string) => location ? new Error(`Using HTTP 1.1 for URL redirect (${location})`) : formatStatusCode(statusCode, value ? 'NGHTTP2 Error ' + value : '');
const concatString = (values: Undef<string[]>) => Array.isArray(values) ? values.reduce((a, b) => a + '\n' + b, '') : '';
const isFunction = <T>(value: unknown): value is T => typeof value === 'function';
const asInt = (value: unknown) => typeof value === 'string' ? parseInt(value) : typeof value === 'number' ? Math.floor(value) : NaN;

class HttpHost implements IHttpHost {
    headers: Undef<OutgoingHttpHeaders>;
    readonly origin: string;
    readonly protocol: string;
    readonly hostname: string;
    readonly port: string;
    readonly secure: boolean;
    readonly localhost: boolean;

    private _url: URL;
    private _version: HttpVersionSupport;
    private _versionData = [
        [0, 0, 0],
        [0, 0, 0]
    ];

    constructor(url: URL, public readonly credentials = '', httpVersion: HttpVersionSupport = 1) {
        const hostname = url.hostname;
        this.origin = url.origin;
        this.protocol = url.protocol;
        this.hostname = hostname;
        this.secure = url.protocol === 'https:';
        this.port = url.port || (this.secure ? '443' : '80');
        this.localhost = hostname === 'localhost' || hostname === '127.0.0.1';
        this.headers = credentials ? { authorization: 'Basic ' + Buffer.from(credentials, 'base64') } as OutgoingHttpHeaders : undefined;
        this._url = url;
        this._version = this.secure || !this.localhost ? httpVersion : 1;
    }
    setHeaders(headers: OutgoingHttpHeaders) {
        this.headers = this.headers ? { ...headers, ...this.headers } : headers;
    }
    success(version?: HttpVersionSupport) {
        if (version) {
            return this._versionData[version - 1][0];
        }
        ++this._versionData[this._version - 1][0];
        return -1;
    }
    failed(version?: HttpVersionSupport) {
        if (version) {
            return this._versionData[version - 1][1];
        }
        ++this._versionData[this._version - 1][1];
        return -1;
    }
    error() {
        return ++this._versionData[this._version - 1][2];
    }
    v2() {
        return this._version === 2;
    }
    clone(version?: HttpVersionSupport) {
        return new HttpHost(this._url, this.credentials, version || this._version);
    }
    set version(value) {
        switch (value) {
            case 1:
            case 2:
                this._version = value;
                break;
        }
    }
    get version() {
        return this._version;
    }
}

class FileManager extends Module implements IFileManager {
    static moduleCompress() {
        return Compress;
    }

    static createPermission() {
        return new Permission();
    }

    static resolveMime(data: BufferOfURI) {
        return data instanceof Buffer ? filetype.fromBuffer(data) : filetype.fromFile(data);
    }

    static formatSize(value: NumString, options?: bytes.BytesOptions): NumString {
        return Module.isString(value) ? bytes(value) : bytes(value, options);
    }

    static fromHttpStatusCode(value: NumString) {
        switch (+value) {
            case HTTP_STATUS.IM_USED:
                return 'IM Used';
            case HTTP_STATUS.FOUND:
                return 'Found';
            case HTTP_STATUS.UPGRADE_REQUIRED:
                return 'Upgrade Required';
            case HTTP_STATUS.MISDIRECTED_REQUEST:
                return 'Misdirected Request';
            case HTTP_STATUS.VARIANT_ALSO_NEGOTIATES:
                return 'Variant Also Negotiates';
            case HTTP_STATUS.INSUFFICIENT_STORAGE:
                return 'Insufficient Storage';
            case HTTP_STATUS.LOOP_DETECTED:
                return 'Loop Detected';
            case HTTP_STATUS.NOT_EXTENDED:
                return 'Not Extended';
            default:
                return httpStatus.getReasonPhrase(value);
        }
    }

    static resetHttpHost(version = 0) {
        switch (version) {
            case 0:
                for (const origin in HTTP_HOST) {
                    delete HTTP_HOST[origin];
                }
                break;
            case 1:
                for (const origin in HTTP_HOST) {
                    HTTP_HOST[origin]!.version = 1;
                }
                break;
            case 2: {
                for (const origin in HTTP_HOST) {
                    const host = HTTP_HOST[origin]!;
                    const failed = host.failed(2);
                    if (failed === 0 || failed < HTTP.MAX_FAILED && host.success(2) > 0) {
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

    static settingsHttpRequest(options: HttpRequestSettings) {
        let { headers, connectTimeout, retryLimit, retryDelay } = options; // eslint-disable-line prefer-const
        if (headers) {
            Object.assign(HTTP_BASEHEADERS, headers);
        }
        if (!isNaN(connectTimeout = asInt(connectTimeout)) && connectTimeout > 0) {
            HTTP_CONNECTTIMEOUT = connectTimeout * 1000;
        }
        if (!isNaN(retryLimit = asInt(retryLimit)) && retryLimit >= 0) {
            HTTP_RETRYLIMIT = retryLimit;
        }
        if (!isNaN(retryDelay = asInt(retryDelay))) {
            HTTP_RETRYDELAY = Math.max(retryDelay, 0);
        }
    }

    static cleanupStream(writable: Writable, uri?: string) {
        try {
            if (!writable.destroyed) {
                writable.destroy();
            }
            if (uri && fs.existsSync(uri)) {
                fs.unlinkSync(uri);
            }
        }
        catch (err) {
            if (!Module.isErrorCode(err, 'ENOENT')) {
                this.writeFail([ERR_MESSAGE.DELETE_FILE, uri], err, this.LOG_TYPE.FILE);
            }
        }
    }

    moduleName = 'filemanager';
    delayed = 0;
    useAcceptEncoding = false;
    keepAliveTimeout = 0;
    cacheHttpRequest = false;
    cacheHttpRequestBuffer: HttpRequestBuffer = { expires: 0, limit: Infinity };
    httpProxy: Null<HttpProxyData> = null;
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
    private _connectHttp1: ObjectMap<number> = {};
    private _connectHttp2: ObjectMap<number> = {};

    constructor(
        readonly baseDirectory: string,
        readonly body: RequestBody,
        postFinalize?: PostFinalizeCallback,
        readonly archiving = false)
    {
        super();
        const assets = this.body.assets;
        this.formatMessage(this.logType.NODE, 'START', [new Date().toLocaleString(), assets.length + ' assets'], this.baseDirectory, { titleBgColor: 'bgYellow', titleColor: 'black' });
        for (const item of assets) {
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
        this.assets = assets;
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
                const interval = asInt(target);
                const port = asInt(params[0]);
                const securePort = asInt(params[1]);
                const instance = new Watch(
                    !isNaN(interval) && interval > 0 ? interval : undefined,
                    !isNaN(port) && port > 0 ? port : undefined,
                    !isNaN(securePort) && securePort > 0 ? securePort : undefined
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
                    manager.httpProxy = this.httpProxy;
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
                    this.writeFail([ERR_MESSAGE.RENAME_FILE, replaceWith], err, this.logType.FILE);
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
    completeAsyncTask(err?: Null<Error>, uri?: string, parent?: ExternalAsset) {
        if (this.delayed !== Infinity) {
            if (!err && uri) {
                this.add(uri, parent);
            }
            this.removeAsyncTask();
            this.performFinalize();
        }
        if (err) {
            this.writeFail([ERR_MESSAGE.UNKNOWN, uri], err, this.logType.FILE);
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
                const errors: string[] = [];
                const postFinalize = this.postFinalize;
                const addErrors = (instance: IModule) => {
                    if (postFinalize) {
                        const items = instance.errors;
                        const length = items.length;
                        if (length) {
                            const moduleName = instance.moduleName;
                            for (let i = 0; i < length; ++i) {
                                errors.push(`[${moduleName}] ` + items[i]);
                            }
                            items.length = 0;
                        }
                    }
                    instance.flushLog();
                };
                addErrors(this);
                if (Module.hasLogType(this.logType.HTTP)) {
                    const output: [string, string, number][] = [];
                    let count = 0;
                    const displayConnect = (data: ObjectMap<number>, version: number) => {
                        const title = 'HTTP' + version;
                        for (const host in data) {
                            const value = data[host]!;
                            output.push([title, host, data[host]!]);
                            if (value > count) {
                                count = value;
                            }
                        }
                    };
                    displayConnect(this._connectHttp2, 2);
                    displayConnect(this._connectHttp1, 1);
                    output.sort((a, b) => b[2] - a[2]);
                    count = count.toString().length;
                    output.forEach(item => this.formatMessage(this.logType.HTTP, item[0], [item[1], 'downloads: ' + item[2].toString().padStart(count)]));
                }
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
                if (postFinalize) {
                    postFinalize(files.map(name => ({ name, size: bytes(Module.getFileSize(path.join(this.baseDirectory, name))) } as FileInfo)), errors);
                }
                const sessionHttp2 = this._sessionHttp2;
                for (const host in sessionHttp2) {
                    sessionHttp2[host]!.close();
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
        if (uri) {
            if (Module.isFileHTTP(uri)) {
                try {
                    file.url = new URL(uri);
                }
                catch {
                }
            }
            else if (!(file.uri = Module.resolveUri(uri))) {
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
        file.mimeType ||= file.url && mime.lookup(file.url.pathname) || mime.lookup(file.filename) || '';
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
    getUTF8String(file: ExternalAsset, uri?: string) {
        if (!file.sourceUTF8) {
            if (file.buffer) {
                file.sourceUTF8 = file.buffer.toString('utf8');
            }
            if (uri ||= file.localUri) {
                try {
                    file.sourceUTF8 = fs.readFileSync(uri, 'utf8');
                }
                catch (err) {
                    this.writeFail([ERR_MESSAGE.READ_FILE, uri], err, this.logType.FILE);
                }
            }
        }
        return file.sourceUTF8 || '';
    }
    setAssetContent(file: ExternalAsset, content: string, options?: AssetContentOptions) {
        const trailing = concatString(file.trailingContent);
        if (trailing) {
            content += trailing;
        }
        if (options) {
            const { uri, index, replacePattern } = options;
            if (index > 0) {
                let appending = this.contentToAppend.get(uri),
                    replacing = this.contentToReplace.get(uri);
                if (!appending) {
                    this.contentToAppend.set(uri, appending = []);
                }
                if (!replacing) {
                    this.contentToReplace.set(uri, replacing = []);
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
        }
        return content;
    }
    getAssetContent(file: ExternalAsset, content = '') {
        const appending = this.contentToAppend.get(file.localUri!);
        if (appending) {
            if (content) {
                const replacing = this.contentToReplace.get(file.localUri!);
                if (replacing && replacing.length) {
                    for (let i = 0; i < replacing.length; ++i) {
                        const value = appending[i];
                        if (Module.isString(value)) {
                            if (replacing[i]) {
                                const match = new RegExp(replacing[i], 'i').exec(content);
                                if (match) {
                                    content = content.substring(0, match.index) + value + '\n' + content.substring(match.index + match[0].length);
                                    continue;
                                }
                            }
                            content += value;
                        }
                    }
                    return content;
                }
            }
            return content + appending.reduce((a, b) => b ? a + '\n' + b : a, '');
        }
        return content;
    }
    writeBuffer(file: ExternalAsset) {
        const buffer = file.sourceUTF8 ? Buffer.from(file.sourceUTF8, 'utf8') : file.buffer;
        if (buffer) {
            try {
                fs.writeFileSync(file.localUri!, buffer);
                return file.buffer = buffer;
            }
            catch (err) {
                this.writeFail([ERR_MESSAGE.WRITE_FILE, file.localUri!], err, this.logType.FILE);
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
                    this.writeFail([ERR_MESSAGE.COPY_FILE, localUri], err, this.logType.FILE);
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
            this.writeFail([ERR_MESSAGE.READ_BUFFER, localUri], err);
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
                        this.writeFail([ERR_MESSAGE.RENAME_FILE, output], err, this.logType.FILE);
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
                                Compress.tryFile(file.buffer || localUri, output, data, (err?: Null<Error>, result?: string) => {
                                    if (result) {
                                        if (data.condition?.includes('%') && Module.getFileSize(result) >= Module.getFileSize(localUri)) {
                                            try {
                                                fs.unlinkSync(result);
                                            }
                                            catch (err_1) {
                                                if (!Module.isErrorCode(err_1, 'ENOENT')) {
                                                    this.writeFail([ERR_MESSAGE.DELETE_FILE, result], err_1, this.logType.FILE);
                                                }
                                            }
                                        }
                                        else {
                                            this.add(result, file);
                                        }
                                    }
                                    if (err) {
                                        this.writeFail([ERR_MESSAGE.COMPRESS_FILE, localUri], err);
                                    }
                                    resolve();
                                });
                            })
                        );
                    }
                }
                catch (err) {
                    this.writeFail([ERR_MESSAGE.READ_FILE, output], err, this.logType.FILE);
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
                const handler = this.Image.get(mimeType) || this.Image.get('handler');
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
                    this.writeFail([ERR_MESSAGE.DELETE_FILE, localUri], err, this.logType.FILE);
                }
            }
            this.completeAsyncTask();
        }
        else {
            this.completeAsyncTask(null, localUri, parent);
        }
    }
    createHttpRequest(url: StringOfURL, httpVersion?: HttpVersionSupport): HttpRequest {
        if (typeof url === 'string') {
            url = new URL(url);
        }
        const credentials = url.username + (url.password ? ':' + url.password : '');
        const host = HTTP_HOST[url.origin + credentials] ||= new HttpHost(url, credentials, this.httpVersion);
        return { host, url, httpVersion: httpVersion || host.version, retries: 0 };
    }
    getHttpClient(uri: StringOfURL, options?: Partial<HttpRequest>) {
        let host: Undef<IHttpHost>,
            url: Undef<URL>,
            method: Undef<string>,
            httpVersion: Undef<HttpVersionSupport>,
            headers: Undef<OutgoingHttpHeaders>,
            pipeTo: Undef<WriteStream>,
            timeout: Undef<number>;
        if (options) {
            ({ host, url, method, httpVersion, headers, pipeTo, timeout } = options);
        }
        if (uri instanceof URL) {
            url = uri;
            uri = url.toString();
        }
        if (!host) {
            ({ host, url } = this.createHttpRequest(url || uri));
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
        let v2: boolean;
        if (httpVersion && host.version !== httpVersion) {
            if (method !== 'HEAD') {
                if (options) {
                    host = host.clone(httpVersion);
                    options.host = host;
                }
                else {
                    HTTP_HOST[host.origin + host.credentials] = host.clone();
                }
                host.version = httpVersion;
            }
            v2 = httpVersion === 2;
        }
        else {
            v2 = host.v2();
        }
        method ||= 'GET';
        const getting = method === 'GET';
        if (getting) {
            if (this.useAcceptEncoding && !host.localhost) {
                (headers ||= {})['accept-encoding'] ||= 'gzip, deflate' + (HTTP_BROTLISUPPORT ? ', br' : '');
            }
        }
        const checkEncoding = (res: IncomingMessage | ClientHttp2Stream, contentEncoding = '', chunkSize?: number): Optional<Transform> => {
            switch (contentEncoding.trim().toLowerCase()) {
                case 'gzip':
                    return res.pipe(zlib.createGunzip({ chunkSize }));
                case 'br':
                    if (HTTP_BROTLISUPPORT) {
                        return res.pipe(zlib.createBrotliDecompress({ chunkSize }));
                    }
                    request.emit('error', new Error('Unable to decompress Brotli encoding'));
                    return null;
                case 'deflate':
                    return res.pipe(zlib.createInflate({ chunkSize }));
            }
        };
        const origin = host.origin;
        const pathname = url.pathname + url.search;
        let request: HttpRequestClient,
            baseHeaders = getBaseHeaders(uri);
        if (v2) {
            let signal: Undef<AbortSignal>;
            if (options && this.supported(15, 4)) {
                const ac = new AbortController();
                signal = ac.signal;
                options.outAbort = ac;
            }
            request = (this._sessionHttp2[origin] ||= http2.connect(origin)).request({ ...baseHeaders, ...host.headers, ...headers, ':path': pathname, ':method': method }, signal && { signal } as PlainObject);
            if (getting) {
                request.on('response', res => {
                    const statusCode = res[':status']!;
                    if (statusCode >= HTTP_STATUS.OK && statusCode < HTTP_STATUS.MULTIPLE_CHOICES) {
                        let compressStream: Optional<Transform>;
                        if (this.useAcceptEncoding && (compressStream = checkEncoding(request as ClientHttp2Stream, res['content-encoding'], pipeTo && pipeTo.writableHighWaterMark))) {
                            if (pipeTo) {
                                compressStream
                                    .on('error', err => request.emit('error', err))
                                    .once('finish', () => {
                                        if (!request.destroyed) {
                                            request.emit('end');
                                            pipeTo!
                                                .on('finish', function(this: Transform) {
                                                    if (!this.destroyed) {
                                                        this.destroy();
                                                    }
                                                })
                                                .emit('finish');
                                        }
                                    })
                                    .pipe(pipeTo)
                                    .on('error', err => request.emit('error', err));
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
                        else if (pipeTo && compressStream !== null) {
                            request
                                .pipe(pipeTo)
                                .on('error', err => request.emit('error', err));
                        }
                        if (!this._connectHttp2[origin]) {
                            this._connectHttp2[origin] = 1;
                        }
                        else {
                            ++this._connectHttp2[origin]!;
                        }
                    }
                });
            }
        }
        else {
            const proxy = this.httpProxy;
            let agent: Undef<Agent>;
            if (proxy && (!proxy.include && !proxy.exclude && !host.localhost || Array.isArray(proxy.include) && proxy.include.find(value => (uri as string).startsWith(value)) || !proxy.include && Array.isArray(proxy.exclude) && !proxy.exclude.find(value => (uri as string).startsWith(value)))) {
                const lib = host.secure ? 'https-proxy-agent' : 'http-proxy-agent';
                try {
                    const proxyHost = proxy.host;
                    const proxyUrl = proxyHost.toString();
                    agent = (require(lib) as FunctionType<Agent>)(this.keepAliveTimeout > 0 ? { protocol: proxyHost.protocol, hostname: proxyHost.hostname, port: proxyHost.port, keepAlive: true, timeout: this.keepAliveTimeout } : proxyUrl);
                    const proxyHeaders = getBaseHeaders(proxyUrl);
                    if (proxyHeaders) {
                        baseHeaders = { ...baseHeaders, ...proxyHeaders };
                    }
                }
                catch (err) {
                    this.writeFail([ERR_MESSAGE.INSTALL, 'npm i ' + lib], err);
                }
            }
            else if (this.keepAliveTimeout > 0) {
                agent = new (host.secure ? HttpsAgent : HttpAgent)({ keepAlive: true, timeout: this.keepAliveTimeout, freeSocketTimeout: HTTP_CONNECTTIMEOUT });
            }
            if (baseHeaders || host.headers) {
                headers = { ...baseHeaders, ...host.headers, ...headers };
            }
            request = (host.secure ? https : http).request({
                protocol: host.protocol,
                hostname: host.hostname,
                port: host.port,
                path: pathname,
                method,
                headers,
                agent
            }, res => {
                let outputStream: Optional<IncomingMessage | Transform>;
                if (getting) {
                    outputStream = checkEncoding(res, res.headers['content-encoding'], pipeTo && pipeTo.writableHighWaterMark);
                    const statusCode = res.statusCode!;
                    if (statusCode >= HTTP_STATUS.OK && statusCode < HTTP_STATUS.MULTIPLE_CHOICES) {
                        if (!this._connectHttp1[origin]) {
                            this._connectHttp1[origin] = 1;
                        }
                        else {
                            ++this._connectHttp1[origin]!;
                        }
                    }
                    if (outputStream === null) {
                        return;
                    }
                }
                if (outputStream ||= res) {
                    outputStream
                        .on('data', chunk => request.emit('data', chunk))
                        .on('close', () => request.emit('close'))
                        .once(outputStream !== res ? 'finish' : 'end', () => {
                            if (!request.destroyed) {
                                request.emit('end');
                            }
                        })
                        .on('error', err => request.emit('error', err));
                    if (pipeTo) {
                        stream.pipeline(outputStream, pipeTo, err => {
                            if (err) {
                                request.emit('error', err);
                            }
                        });
                    }
                }
            }) as ClientRequest;
        }
        if (timeout !== 0) {
            request.setTimeout(timeout || HTTP_CONNECTTIMEOUT);
        }
        request.end();
        return request;
    }
    fetchBuffer(uri: StringOfURL, options?: Partial<HttpRequest>) {
        return new Promise<Null<Buffer>>(resolve => {
            try {
                const time = Date.now();
                let server = this.createHttpRequest(uri);
                if (options) {
                    server = Object.assign(options, server);
                }
                (function downloadUri(this: IFileManager, httpVersion?: HttpVersionSupport) {
                    if (httpVersion) {
                        server.httpVersion = httpVersion;
                    }
                    const result = options || server;
                    const client = this.getHttpClient(uri, server);
                    const host = server.host;
                    let aborted: Undef<boolean>;
                    result.outBuffer = null;
                    const downloadEnd = () => {
                        if (!aborted) {
                            if (result.outBuffer) {
                                this.writeTimeProcess('HTTP' + host.version, server.url.toString(), time, { type: this.logType.HTTP, meterIncrement: 100, queue: true });
                            }
                            resolve(result.outBuffer!);
                        }
                    };
                    const downloadAbort = (err: unknown, statusCode = HTTP_STATUS.BAD_REQUEST) => {
                        result.outError = err || formatStatusCode(statusCode);
                        resolve(result.outBuffer = null);
                    };
                    if (host.v2()) {
                        const retryDownload = (downgrade: boolean, err?: Error) => {
                            if (err) {
                                warnProtocol.call(this, host, err);
                            }
                            if (!aborted) {
                                if (!abortHttpRequest(client, server)) {
                                    client.destroy();
                                }
                                if (downgrade) {
                                    downgradeHost(host);
                                }
                                downloadUri.call(this, 1);
                            }
                        };
                        (client as ClientHttp2Stream)
                            .on('response', (headers, flags) => {
                                if (!isAborted(host, client)) {
                                    const statusCode = headers[':status']!;
                                    if (statusCode < HTTP_STATUS.MULTIPLE_CHOICES) {
                                        client.on('end', downloadEnd.bind(this));
                                        host.success();
                                    }
                                    else if (invalidRequest(statusCode)) {
                                        downloadAbort(null, statusCode);
                                    }
                                    else if (downgradeVersion(statusCode)) {
                                        retryDownload(true, formatNgFlags(http2.constants.NGHTTP2_PROTOCOL_ERROR, statusCode));
                                    }
                                    else if (isRetryStatus(statusCode) && ++server.retries <= HTTP_RETRYLIMIT) {
                                        setTimeout(downloadUri.bind(this), HTTP_RETRYDELAY);
                                    }
                                    else if (statusCode >= HTTP_STATUS.BAD_REQUEST) {
                                        if (HTTP2_UNSUPPORTED.includes(flags)) {
                                            retryDownload(true, formatNgFlags(flags, statusCode));
                                        }
                                        else {
                                            ++server.retries;
                                            retryDownload(false);
                                        }
                                    }
                                    else {
                                        retryDownload(false, formatNgFlags(0, statusCode, headers.location));
                                    }
                                }
                            })
                            .on('error', err => {
                                if (!aborted) {
                                    if (isConnectionTimeout(err)) {
                                        ++server.retries;
                                    }
                                    retryDownload(host.error() >= HTTP.MAX_ERROR || isDowngrade(err) || !isRetryError(err), err);
                                }
                            });
                    }
                    else {
                        (client as ClientRequest)
                            .on('response', res => {
                                const statusCode = res.statusCode!;
                                if (statusCode < HTTP_STATUS.MULTIPLE_CHOICES) {
                                    res.on('end', downloadEnd.bind(this));
                                    host.success();
                                }
                                else if (isRetryStatus(statusCode) && ++server.retries <= HTTP_RETRYLIMIT) {
                                    setTimeout(downloadUri.bind(this), HTTP_RETRYDELAY);
                                }
                                else {
                                    downloadAbort(null, statusCode);
                                }
                            })
                            .on('error', err => {
                                const retry = isRetryError(err);
                                if (retry && ++server.retries <= HTTP_RETRYLIMIT) {
                                    if (isConnectionTimeout(err)) {
                                        warnConnectTimeout.call(this, server);
                                        setTimeout(downloadUri.bind(this), 0);
                                    }
                                    else {
                                        setTimeout(downloadUri.bind(this), HTTP_RETRYDELAY);
                                    }
                                }
                                else {
                                    if (!retry) {
                                        host.failed();
                                    }
                                    downloadAbort(err);
                                }
                            });
                    }
                    client.on('data', data => {
                        result.outBuffer = result.outBuffer ? Buffer.concat([result.outBuffer, data]) : data;
                    });
                }).bind(this)();
            }
            catch (err) {
                this.writeFail([ERR_MESSAGE.READ_BUFFER, uri.toString()], err, this.logType.HTTP);
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
            this.writeFail([ERR_MESSAGE.READ_FILE, uri], new Error(`Insufficient permissions (${uri})`));
            file.invalid = true;
        };
        const setHeaderData = (file: ExternalAsset, headers: IncomingHttpHeaders, lastModified?: boolean) => {
            let contentLength: Undef<NumString> = headers['content-length'];
            if (contentLength && !isNaN(contentLength = parseInt(contentLength))) {
                file.contentLength = contentLength;
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
        const setTempBuffer = (uri: string, etag: string, buffer: Buffer, contentLength = Buffer.byteLength(buffer), tempUri?: string) => {
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
                if (Module.mkdirSafe(tempDir)) {
                    return tempDir;
                }
            }
        };
        const checkQueue = (file: ExternalAsset, localUri: string, content?: boolean) => {
            const bundleIndex = file.bundleIndex!;
            if (bundleIndex >= 0) {
                const items = appending[localUri] ||= [];
                if (bundleIndex > 0) {
                    items[bundleIndex - 1] = file;
                    if (!file.content && (this.cacheHttpRequest || bufferLimit > 0)) {
                        const { uri, bundleId } = file;
                        const parent = this.assets.find(item => item.bundleIndex === 0 && item.bundleId === bundleId);
                        if (parent) {
                            (parent.bundleQueue ||= []).push(
                                new Promise<ExternalAsset>(resolve => {
                                    (this.getHttpClient(uri!, { method: 'HEAD', httpVersion: 1 }) as ClientRequest)
                                        .on('response', res => {
                                            if (res.statusCode! < HTTP_STATUS.MULTIPLE_CHOICES) {
                                                setHeaderData(file, res.headers);
                                            }
                                            resolve(file);
                                        })
                                        .on('error', () => resolve(file));
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
        const verifyBundle = (file: ExternalAsset, uri: string, value: Null<string | Buffer>, etag?: string) => {
            if (!file.invalid) {
                if (value) {
                    if (value instanceof Buffer) {
                        if (etag) {
                            setTempBuffer(file.uri!, encodeURIComponent(etag), value, file.contentLength);
                        }
                        value = value.toString('utf8');
                    }
                    this.setAssetContent(file, value, { uri, index: file.bundleIndex!, replacePattern: file.bundleReplace });
                }
                else {
                    file.invalid = true;
                }
            }
        };
        const processQueue = async (file: ExternalAsset, localUri: string) => {
            completed.push(localUri);
            if (file.bundleIndex === 0) {
                file.sourceUTF8 = this.setAssetContent(file, this.getUTF8String(file, localUri));
                if (file.bundleQueue) {
                    await Module.allSettled(file.bundleQueue);
                }
                const items = appending[localUri];
                let success = true;
                if (items) {
                    const tasks: Promise<void>[] = [];
                    for (const queue of items) {
                        if (!queue.invalid) {
                            const { uri, content } = queue;
                            if (content) {
                                verifyBundle(queue, localUri, content);
                            }
                            else if (uri) {
                                const url = queue.url;
                                if (url) {
                                    tasks.push(new Promise<void>((resolve, reject) => {
                                        try {
                                            const time = Date.now();
                                            let etag = queue.etag,
                                                baseDir: Undef<string>,
                                                tempDir: Undef<string>,
                                                etagDir: Undef<string>,
                                                tempUri: Undef<string>;
                                            if (etag) {
                                                tempDir = createTempDir(url);
                                                etagDir = encodeURIComponent(etag);
                                                const cached = HTTP_BUFFER[uri];
                                                if (cached) {
                                                    if (etagDir === cached[0]) {
                                                        verifyBundle(queue, localUri, cached[1].toString('utf8'));
                                                        resolve();
                                                        return;
                                                    }
                                                    clearTempBuffer(uri, tempDir && path.join(tempDir, cached[0], path.basename(localUri)));
                                                }
                                                if (tempDir) {
                                                    tempUri = path.join(baseDir = path.join(tempDir, etagDir), path.basename(localUri));
                                                    try {
                                                        if (Module.hasSize(tempUri)) {
                                                            verifyBundle(queue, localUri, fs.readFileSync(tempUri), etag);
                                                            resolve();
                                                            return;
                                                        }
                                                        else if (!fs.existsSync(baseDir)) {
                                                            fs.mkdirSync(baseDir);
                                                        }
                                                    }
                                                    catch {
                                                        tempUri = undefined;
                                                    }
                                                }
                                            }
                                            const options = this.createHttpRequest(url);
                                            const errorRequest = (err: Error) => {
                                                if (!notFound.includes(uri)) {
                                                    notFound.push(uri);
                                                    this.writeFail([ERR_MESSAGE.DOWNLOAD_FILE, uri], err);
                                                }
                                                if (options.pipeTo) {
                                                    FileManager.cleanupStream(options.pipeTo, tempUri);
                                                }
                                                queue.invalid = true;
                                                resolve();
                                            };
                                            (function downloadUri(this: IFileManager, httpVersion?: HttpVersionSupport) {
                                                let buffer: Null<Buffer> = null,
                                                    aborted: Undef<boolean>;
                                                if (tempUri) {
                                                    if (options.pipeTo) {
                                                        FileManager.cleanupStream(options.pipeTo, tempUri);
                                                    }
                                                    options.pipeTo = fs.createWriteStream(tempUri, { highWaterMark: !options.host.localhost ? HTTP.CHUNK_SIZE : HTTP.CHUNK_SIZE_LOCAL });
                                                }
                                                if (httpVersion) {
                                                    options.httpVersion = httpVersion;
                                                }
                                                const client = this.getHttpClient(uri, options);
                                                const host = options.host;
                                                const retryDownload = (downgrade: boolean, err?: Error) => {
                                                    if (err) {
                                                        warnProtocol.call(this, host, err);
                                                    }
                                                    if (!aborted) {
                                                        if (!abortHttpRequest(client, options)) {
                                                            client.destroy();
                                                        }
                                                        aborted = true;
                                                        buffer = null;
                                                        if (downgrade) {
                                                            downgradeHost(host);
                                                        }
                                                        downloadUri.call(this, 1);
                                                    }
                                                };
                                                const checkResponse = (statusCode: number, headers: IncomingHttpHeaders, flags: number) => {
                                                    if (statusCode < HTTP_STATUS.MULTIPLE_CHOICES) {
                                                        etag = setHeaderData(queue, headers, true);
                                                        client
                                                            .on('data', data => {
                                                                buffer = buffer ? Buffer.concat([buffer, data]) : data;
                                                            })
                                                            .on('end', () => {
                                                                if (!aborted) {
                                                                    this.writeTimeProcess('HTTP' + host.version, url.toString() + ` (${queue.bundleIndex!})`, time, { type: this.logType.HTTP, meterIncrement: 100, queue: true });
                                                                    verifyBundle(queue, localUri, buffer, etag);
                                                                    resolve();
                                                                }
                                                            });
                                                        host.success();
                                                    }
                                                    else if (invalidRequest(statusCode)) {
                                                        errorRequest(formatStatusCode(statusCode));
                                                    }
                                                    else if (isRetryStatus(statusCode) && ++options.retries <= HTTP_RETRYLIMIT) {
                                                        setTimeout(downloadUri.bind(this), HTTP_RETRYDELAY);
                                                    }
                                                    else if (host.v2()) {
                                                        if (statusCode >= HTTP_STATUS.BAD_REQUEST) {
                                                            if (HTTP2_UNSUPPORTED.includes(flags)) {
                                                                retryDownload(true, formatNgFlags(flags, statusCode));
                                                            }
                                                            else {
                                                                ++options.retries;
                                                                retryDownload(false);
                                                            }
                                                        }
                                                        else {
                                                            retryDownload(false, formatNgFlags(0, statusCode, headers.location));
                                                        }
                                                    }
                                                    else {
                                                        errorRequest(formatStatusCode(statusCode));
                                                    }
                                                };
                                                if (host.v2()) {
                                                    (client as ClientHttp2Stream)
                                                        .on('response', (headers, flags) => {
                                                            if (!isAborted(host, client)) {
                                                                const statusCode = headers[':status']!;
                                                                if (downgradeVersion(statusCode)) {
                                                                    retryDownload(true, formatNgFlags(http2.constants.NGHTTP2_PROTOCOL_ERROR, statusCode));
                                                                }
                                                                else {
                                                                    checkResponse(statusCode, headers, flags);
                                                                }
                                                            }
                                                        })
                                                        .on('error', err => {
                                                            if (!aborted) {
                                                                if (isConnectionTimeout(err)) {
                                                                    ++options.retries;
                                                                }
                                                                retryDownload(host.error() >= HTTP.MAX_ERROR || isDowngrade(err) || !isRetryError(err), err);
                                                            }
                                                        });
                                                }
                                                else {
                                                    (client as ClientRequest)
                                                        .on('response', res => checkResponse(res.statusCode!, res.headers, 0))
                                                        .on('error', err => {
                                                            const retry = isRetryError(err);
                                                            if (retry && ++options.retries <= HTTP_RETRYLIMIT) {
                                                                if (isConnectionTimeout(err)) {
                                                                    warnConnectTimeout.call(this, options);
                                                                    setTimeout(downloadUri.bind(this), 0);
                                                                }
                                                                else {
                                                                    setTimeout(downloadUri.bind(this), HTTP_RETRYDELAY);
                                                                }
                                                            }
                                                            else {
                                                                if (!retry) {
                                                                    host.failed();
                                                                }
                                                                errorRequest(err);
                                                            }
                                                        });
                                                }
                                            }).bind(this)();
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
                                                verifyBundle(queue, localUri, data);
                                            }
                                            else {
                                                this.writeFail([ERR_MESSAGE.READ_FILE, uri], err, this.logType.FILE);
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
                        success = await Promise.all(tasks)
                            .then(() => true)
                            .catch(err => {
                                this.writeFail([ERR_MESSAGE.DOWNLOAD_FILE, 'bundle: ' + path.basename(localUri)], err);
                                return false;
                            });
                    }
                }
                if (success) {
                    this.transformAsset({ file });
                }
                else {
                    try {
                        fs.unlinkSync(localUri);
                    }
                    catch (err) {
                        if (!Module.isErrorCode(err, 'ENOENT')) {
                            this.writeFail([ERR_MESSAGE.DELETE_FILE, localUri], err, this.logType.FILE);
                        }
                    }
                    file.invalid = true;
                    delete file.buffer;
                    delete file.sourceUTF8;
                    this.completeAsyncTask();
                }
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
                            if (!Module.mkdirSafe(pathname)) {
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
                            this.writeFail([ERR_MESSAGE.COPY_FILE, localUri], err, this.logType.FILE);
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
        const errorRequest = (file: ExternalAsset, err: Error, pipeTo?: Null<WriteStream>) => {
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
            this.writeFail([ERR_MESSAGE.DOWNLOAD_FILE, uri], err);
            if (pipeTo) {
                FileManager.cleanupStream(pipeTo, localUri);
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
                            this.writeFail([ERR_MESSAGE.DELETE_DIRECTORY, pathname], err);
                        }
                    }
                    if (Module.mkdirSafe(pathname)) {
                        emptied.push(pathname);
                    }
                    else {
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
                    const url = item.url;
                    if (url) {
                        if (!checkQueue(item, localUri)) {
                            if (downloading[uri]) {
                                downloading[uri]!.push(item);
                            }
                            else if (createFolder()) {
                                const options = this.createHttpRequest(url);
                                const tempDir = createTempDir(url);
                                const time = Date.now();
                                downloading[uri] = [];
                                this.performAsyncTask();
                                const downloadUri = (etagDir?: string, httpVersion?: HttpVersionSupport) => {
                                    if (options.pipeTo) {
                                        FileManager.cleanupStream(options.pipeTo, localUri);
                                    }
                                    options.pipeTo = fs.createWriteStream(localUri, { highWaterMark: !options.host.localhost ? HTTP.CHUNK_SIZE : HTTP.CHUNK_SIZE_LOCAL });
                                    if (httpVersion) {
                                        options.httpVersion = httpVersion;
                                    }
                                    const client = this.getHttpClient(uri, options);
                                    const host = options.host;
                                    let aborted: Undef<boolean>;
                                    const retryDownload = (downgrade: boolean, err?: Error) => {
                                        if (err) {
                                            warnProtocol.call(this, host, err);
                                        }
                                        if (!aborted) {
                                            if (!abortHttpRequest(client, options)) {
                                                client.destroy();
                                            }
                                            aborted = true;
                                            delete item.buffer;
                                            if (downgrade) {
                                                downgradeHost(host);
                                            }
                                            downloadUri(etagDir, 1);
                                        }
                                    };
                                    const checkResponse = (statusCode: number, headers: IncomingHttpHeaders, flags: number) => {
                                        if (statusCode < HTTP_STATUS.MULTIPLE_CHOICES) {
                                            setHeaderData(item, headers, true);
                                            if (item.willChange || isCacheable(item)) {
                                                client.on('data', data => {
                                                    item.buffer = item.buffer ? Buffer.concat([item.buffer, data]) : data;
                                                });
                                            }
                                            host.success();
                                        }
                                        else if (isRetryStatus(statusCode) && ++options.retries <= HTTP_RETRYLIMIT) {
                                            setTimeout(downloadUri.bind(this), HTTP_RETRYDELAY);
                                        }
                                        else if (host.v2()) {
                                            if (statusCode >= HTTP_STATUS.BAD_REQUEST) {
                                                if (HTTP2_UNSUPPORTED.includes(flags)) {
                                                    retryDownload(true, formatNgFlags(flags, statusCode));
                                                }
                                                else {
                                                    ++options.retries;
                                                    retryDownload(false);
                                                }
                                            }
                                            else {
                                                retryDownload(false, formatNgFlags(0, statusCode, headers.location));
                                            }
                                        }
                                        else {
                                            errorRequest(item, formatStatusCode(statusCode), options.pipeTo);
                                        }
                                    };
                                    if (host.v2()) {
                                        (client as ClientHttp2Stream)
                                            .on('response', (headers, flags) => {
                                                if (!isAborted(host, client)) {
                                                    const statusCode = headers[':status']!;
                                                    if (invalidRequest(statusCode)) {
                                                        errorRequest(item, formatStatusCode(statusCode), options.pipeTo);
                                                    }
                                                    else if (downgradeVersion(statusCode)) {
                                                        retryDownload(true, formatNgFlags(http2.constants.NGHTTP2_PROTOCOL_ERROR, statusCode));
                                                    }
                                                    else {
                                                        checkResponse(statusCode, headers, flags);
                                                    }
                                                }
                                            })
                                            .on('error', err => {
                                                if (!aborted) {
                                                    if (isConnectionTimeout(err)) {
                                                        ++options.retries;
                                                    }
                                                    retryDownload(host.error() >= HTTP.MAX_ERROR || isDowngrade(err) || !isRetryError(err), err);
                                                }
                                            });
                                    }
                                    else {
                                        (client as ClientRequest)
                                            .on('response', res => checkResponse(res.statusCode!, res.headers, 0))
                                            .on('error', err => {
                                                const retry = isRetryError(err);
                                                if (retry && ++options.retries <= HTTP_RETRYLIMIT) {
                                                    if (isConnectionTimeout(err)) {
                                                        warnConnectTimeout.call(this, options);
                                                        setTimeout(downloadUri.bind(this), 0);
                                                    }
                                                    else {
                                                        setTimeout(downloadUri.bind(this), HTTP_RETRYDELAY);
                                                    }
                                                }
                                                else {
                                                    if (!retry) {
                                                        host.failed();
                                                    }
                                                    errorRequest(item, err, options.pipeTo);
                                                }
                                            });
                                    }
                                    options.pipeTo.on('finish', () => {
                                        if (!aborted && !notFound.includes(uri)) {
                                            this.writeTimeProcess('HTTP' + host.version, url.toString() + (item.bundleIndex === 0 ? ' (0)' : ''), time, { type: this.logType.HTTP, meterIncrement: 100, queue: true });
                                            processQueue(item, localUri);
                                            if (etagDir) {
                                                const buffer = item.buffer;
                                                if (tempDir) {
                                                    const baseDir = path.join(tempDir, etagDir);
                                                    const tempUri = path.join(baseDir, path.basename(localUri));
                                                    try {
                                                        if (!fs.existsSync(baseDir)) {
                                                            fs.mkdirSync(baseDir);
                                                        }
                                                        if (buffer) {
                                                            if (bufferLimit > 0) {
                                                                setTempBuffer(uri, etagDir, buffer, item.contentLength, tempUri);
                                                            }
                                                            fs.writeFile(tempUri, buffer);
                                                        }
                                                        else if (fs.statSync(localUri).size > 0) {
                                                            fs.copyFile(localUri, tempUri);
                                                        }
                                                    }
                                                    catch (err) {
                                                        this.writeFail([ERR_MESSAGE.WRITE_FILE, tempUri], err, this.logType.FILE);
                                                    }
                                                }
                                                else if (bufferLimit > 0 && buffer) {
                                                    setTempBuffer(uri, etagDir, buffer, item.contentLength);
                                                }
                                            }
                                        }
                                    });
                                };
                                (function checkHeaders(this: IFileManager) {
                                    (this.getHttpClient(uri, { method: 'HEAD', httpVersion: 1 }) as ClientRequest)
                                        .on('response', res => {
                                            const statusCode = res.statusCode!;
                                            if (statusCode >= HTTP_STATUS.MULTIPLE_CHOICES) {
                                                if (isRetryStatus(statusCode) && ++options.retries <= HTTP_RETRYLIMIT) {
                                                    setTimeout(checkHeaders.bind(this), HTTP_RETRYDELAY);
                                                }
                                                else {
                                                    errorRequest(item, formatStatusCode(statusCode));
                                                }
                                            }
                                            else {
                                                const etag = setHeaderData(item, res.headers);
                                                let etagDir: Undef<string>;
                                                if (Module.isString(etag)) {
                                                    etagDir = encodeURIComponent(etag);
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
                                                            const tempUri = path.join(tempDir, etagDir, path.basename(localUri));
                                                            if (Module.hasSize(tempUri)) {
                                                                if (!buffer && isCacheable(item)) {
                                                                    setTempBuffer(uri, etagDir, buffer = fs.readFileSync(tempUri), item.contentLength, tempUri);
                                                                }
                                                                if (this.archiving || !Module.hasSameStat(tempUri, localUri)) {
                                                                    if (buffer) {
                                                                        fs.writeFileSync(localUri, buffer);
                                                                    }
                                                                    else {
                                                                        fs.copyFileSync(tempUri, localUri);
                                                                    }
                                                                }
                                                                if (buffer && item.willChange) {
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
                                        .on('error', err => {
                                            const retry = isRetryError(err);
                                            if (!retry && ++options.retries <= HTTP_RETRYLIMIT) {
                                                setTimeout(checkHeaders.bind(this), isConnectionTimeout(err) ? 0 : HTTP_RETRYDELAY);
                                            }
                                            else {
                                                if (!retry) {
                                                    options.host.failed();
                                                }
                                                errorRequest(item, err);
                                            }
                                        });
                                }).bind(this)();
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
                            this.writeFail([ERR_MESSAGE.DELETE_FILE, value], err, this.logType.FILE);
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
            const tasks: Promise<unknown>[] = [];
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
                                    if (files.length === 1 && item.buffer) {
                                        image.buffer = item.buffer;
                                    }
                                    tasks.push(new Promise<void>(resolve => {
                                        Compress.tryImage(file, image, (err?: Null<Error>, value?: Null<unknown>) => {
                                            if (file === item.localUri) {
                                                item.buffer = value instanceof Buffer ? value : undefined;
                                            }
                                            if (err) {
                                                this.writeFail([ERR_MESSAGE.COMPRESS_FILE, file], err);
                                            }
                                            resolve();
                                        });
                                    }));
                                }
                            }
                        }
                    }
                }
            }
            if (tasks.length) {
                await Module.allSettled(tasks);
            }
        }
        for (const { instance, constructor } of this.Document) {
            if (instance.assets.length) {
                await constructor.finalize.call(this, instance);
            }
        }
        for (const item of this.assets) {
            if (item.sourceUTF8 && !item.invalid) {
                try {
                    fs.writeFileSync(item.localUri!, item.sourceUTF8, 'utf8');
                }
                catch (err) {
                    this.writeFail([ERR_MESSAGE.WRITE_FILE, item.localUri!], err);
                }
            }
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
            const tasks: Promise<unknown>[] = [];
            for (const item of this.assets) {
                if (item.compress && !item.invalid) {
                    tasks.push(this.compressFile(item, false));
                }
            }
            if (tasks.length) {
                await Module.allSettled(tasks, { rejected: 'Compress files', errors: this.errors });
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