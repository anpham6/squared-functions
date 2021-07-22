import type { DataSource, FileInfo, TextEncoding } from '../types/lib/squared';

import type { DocumentConstructor, ICloud, ICompress, IDocument, IFileManager, IModule, ITask, IWatch, ImageConstructor, TaskConstructor } from '../types/lib';
import type { ExternalAsset, FileOutput, FileProcessing, OutputFinalize } from '../types/lib/asset';
import type { CloudDatabase } from '../types/lib/cloud';
import type { AssetContentOptions, HttpBaseHeaders, HttpRequestBuffer, HttpRequestSettings, InstallData, PostFinalizeCallback } from '../types/lib/filemanager';
import type { HttpProxyData, HttpRequest, HttpRequestClient, HttpRequestOptions, HttpVersionSupport, IHttpHost } from '../types/lib/http';
import type { CloudModule, DocumentModule } from '../types/lib/module';
import type { RequestBody } from '../types/lib/node';

import type { WriteStream } from 'fs';
import type { Agent, ClientRequest, IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders } from 'http';
import type { ClientHttp2Stream } from 'http2';
import type { Transform, Writable } from 'stream';
import type { BackgroundColor } from 'chalk';

import { ERR_MESSAGE } from '../types/lib/logger';

import path = require('path');
import fs = require('fs-extra');
import http = require('http');
import https = require('https');
import http2 = require('http2');
import tls = require('tls');
import stream = require('stream');
import zlib = require('zlib');
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

const enum HTTP { // eslint-disable-line no-shadow
    MAX_FAILED = 5,
    MAX_ERROR = 10,
    CHUNK_SIZE = 4 * 1024,
    CHUNK_SIZE_LOCAL = 64 * 1024
}

export const enum HTTP_STATUS { // eslint-disable-line no-shadow
    CONTINUE = 100,
    SWITCHING_PROTOCOL = 101,
    PROCESSING = 102,
    EARLY_HINTS = 103,
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
    RANGE_NOT_SATISFIABLE = 416,
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
    WEB_SERVER_IS_DOWN = 521,
    CONNECTION_TIMED_OUT = 522,
    A_TIMEOUT_OCCURRED = 524
}

const enum HOST_VERSION { // eslint-disable-line no-shadow
    SUCCESS = 0,
    FAILED = 1,
    ERROR = 2,
    ALPN = 3
}

const HTTP2_UNSUPPORTED = [
    http2.constants.NGHTTP2_PROTOCOL_ERROR /* 1 */,
    http2.constants.NGHTTP2_CONNECT_ERROR /* 10 */,
    http2.constants.NGHTTP2_INADEQUATE_SECURITY /* 12 */,
    http2.constants.NGHTTP2_HTTP_1_1_REQUIRED /* 13 */
];

const HTTP_HOST: ObjectMap<IHttpHost> = {};
const HTTP_BASEHEADERS: HttpBaseHeaders = {};
const HTTP_BUFFER: ObjectMap<Null<[string, BufferContent]>> = {};
const HTTP_BROTLISUPPORT = Module.supported(11, 7) || Module.supported(10, 16, 0, true);
let HTTP_CONNECTTIMEOUT = 10 * 1000;
let HTTP_REDIRECTLIMIT = 10;
let HTTP_RETRYLIMIT = 3;
let HTTP_RETRYDELAY = 1000;
let HTTP_RETRYAFTER = 30 * 1000;

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

function isRetryStatus(value: number, timeout?: boolean) {
    switch (value) {
        case HTTP_STATUS.REQUEST_TIMEOUT:
        case HTTP_STATUS.GATEWAY_TIMEOUT:
        case HTTP_STATUS.CONNECTION_TIMED_OUT:
        case HTTP_STATUS.A_TIMEOUT_OCCURRED:
            if (timeout) {
                return true;
            }
        case HTTP_STATUS.TOO_MANY_REQUESTS:
        case HTTP_STATUS.CLIENT_CLOSED_REQUEST:
        case HTTP_STATUS.INTERNAL_SERVER_ERROR:
        case HTTP_STATUS.BAD_GATEWAY:
        case HTTP_STATUS.SERVICE_UNAVAILABLE:
        case HTTP_STATUS.WEB_SERVER_IS_DOWN:
            if (!timeout) {
                return true;
            }
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

export function isConnectionTimeout(err: unknown) {
    if (err instanceof Error) {
        switch ((err as SystemError).code) {
            case 'ECONNRESET':
            case 'ETIMEDOUT':
                return true;
        }
    }
    return false;
}

export function formatStatusCode(value: NumString, hint?: string) {
    return new Error(value + ': ' + FileManager.fromHttpStatusCode(value) + (hint ? ` (${hint})` : ''));
}

function getLocation(url: URL, value: string) {
    if (Module.isFileHTTP(value)) {
        return value;
    }
    const credentials = formatCredentials(url);
    return url.protocol + '//' + (credentials ? credentials + '@' : '') + url.hostname + (url.port ? ':' + url.port : '') + (value[0] !== '/' ? '/' : '') + value;
}

const formatCredentials = (url: URL) => url.username ? decodeURIComponent(url.username) + (url.password ? ':' + decodeURIComponent(url.password) : '') : '';
const getRedirectError = () => formatStatusCode(HTTP_STATUS.BAD_REQUEST, `Redirect limit exceeded (${HTTP_REDIRECTLIMIT})`);
const concatString = (values: Undef<string[]>) => Array.isArray(values) ? values.reduce((a, b) => a + '\n' + b, '') : '';
const asInt = (value: unknown) => typeof value === 'string' ? parseInt(value) : typeof value === 'number' ? Math.floor(value) : NaN;
const isFunction = <T>(value: unknown): value is T => typeof value === 'function';

class HttpHost implements IHttpHost {
    readonly origin: string;
    readonly protocol: string;
    readonly hostname: string;
    readonly port: string;
    readonly secure: boolean;
    readonly localhost: boolean;

    private _url: URL;
    private _headers: Undef<OutgoingHttpHeaders>;
    private _version: HttpVersionSupport;
    private _versionData = [
        [0, 0, 0, 1],
        [0, 0, 0, -1]
    ];
    private _tlsConnect: Null<Promise<boolean>> = null;

    constructor(url: URL, public readonly credentials = '', httpVersion: HttpVersionSupport = 1) {
        const hostname = url.hostname;
        this.origin = url.origin;
        this.protocol = url.protocol;
        this.hostname = hostname;
        this.secure = url.protocol === 'https:';
        this.port = url.port || (this.secure ? '443' : '80');
        this.localhost = hostname === 'localhost' || hostname === '127.0.0.1';
        this._headers = credentials ? { authorization: 'Basic ' + Buffer.from(credentials, 'base64') } as OutgoingHttpHeaders : undefined;
        this._url = url;
        this._version = this.secure ? httpVersion : 1;
    }

    async hasProtocol(version: HttpVersionSupport) {
        if (this._version > 1) {
            if (!this.secure) {
                return false;
            }
            const data = this._versionData[this._version - 1];
            switch (data[HOST_VERSION.ALPN]) {
                case 0:
                    return false;
                case 1:
                    return true;
            }
            return this._tlsConnect ||= new Promise<boolean>(resolve => {
                const alpn = 'h' + version;
                const socket = tls.connect(+this.port, this.hostname, { ALPNProtocols: [alpn], requestCert: true, rejectUnauthorized: false }, () => {
                    const result = alpn === socket.alpnProtocol;
                    data[HOST_VERSION.ALPN] = result ? 1 : 0;
                    resolve(result);
                    this._tlsConnect = null;
                });
                socket
                    .setNoDelay(false)
                    .setTimeout(HTTP_CONNECTTIMEOUT)
                    .on('timeout', () => {
                        if (this._tlsConnect) {
                            this.error(version);
                            resolve(false);
                            this._tlsConnect = null;
                        }
                        socket.destroy();
                    })
                    .on('error', () => {
                        this.failed(version);
                        data[HOST_VERSION.ALPN] = 0;
                        resolve(false);
                        this._tlsConnect = null;
                    })
                    .end();
            });
        }
        return true;
    }
    success(version?: HttpVersionSupport) {
        if (version) {
            return this._versionData[version - 1][HOST_VERSION.SUCCESS];
        }
        ++this._versionData[this._version - 1][HOST_VERSION.SUCCESS];
        return -1;
    }
    failed(version?: HttpVersionSupport) {
        if (version) {
            return this._versionData[version - 1][HOST_VERSION.FAILED];
        }
        ++this._versionData[this._version - 1][HOST_VERSION.FAILED];
        return -1;
    }
    error(version: HttpVersionSupport = this.version) {
        return ++this._versionData[version - 1][HOST_VERSION.ERROR];
    }
    clone(version?: HttpVersionSupport) {
        return new HttpHost(this._url, this.credentials, version || this._version);
    }
    v2() {
        return this._version === 2;
    }
    set headers(value: Undef<OutgoingHttpHeaders>) {
        if (this._headers) {
            this._headers = Object.assign(this._headers, value);
        }
        else {
            this._headers = value;
        }
    }
    get headers() {
        return this._headers;
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
            case HTTP_STATUS.CONTINUE:
                return 'Continue';
            case HTTP_STATUS.SWITCHING_PROTOCOL:
                return 'Switching Protocol';
            case HTTP_STATUS.PROCESSING:
                return 'Processing';
            case HTTP_STATUS.EARLY_HINTS:
                return 'Early Hints';
            case HTTP_STATUS.OK:
                return 'OK';
            case HTTP_STATUS.CREATED:
                return 'Created';
            case HTTP_STATUS.ACCEPTED:
                return 'Accepted';
            case HTTP_STATUS.NON_AUTHORITATIVE_INFORMATION:
                return 'Non-Authoritative Information';
            case HTTP_STATUS.NO_CONTENT:
                return 'No Content';
            case HTTP_STATUS.RESET_CONTENT:
                return 'Reset Content';
            case HTTP_STATUS.PARTIAL_CONTENT:
                return 'Partial Content';
            case HTTP_STATUS.MULTI_STATUS:
                return 'Multi-Status';
            case HTTP_STATUS.ALREADY_REPORTED:
                return 'Already Reported';
            case HTTP_STATUS.IM_USED:
                return 'IM Used';
            case HTTP_STATUS.MULTIPLE_CHOICES:
                return 'Multiple Choice';
            case HTTP_STATUS.MOVED_PERMANENTLY:
                return 'Moved Permanently';
            case HTTP_STATUS.FOUND:
                return 'Found';
            case HTTP_STATUS.SEE_OTHER:
                return 'See Other';
            case HTTP_STATUS.NOT_MODIFIED:
                return 'Not Modified';
            case HTTP_STATUS.USE_PROXY:
                return 'Use Proxy';
            case HTTP_STATUS.TEMPORARY_REDIRECT:
                return 'Temporary Redirect';
            case HTTP_STATUS.PERMANENT_REDIRECT:
                return 'Permanent Redirect';
            case HTTP_STATUS.BAD_REQUEST:
                return 'Bad Request';
            case HTTP_STATUS.UNAUTHORIZED:
                return 'Upgrade Required';
            case HTTP_STATUS.PAYMENT_REQUIRED:
                return 'Payment Required';
            case HTTP_STATUS.FORBIDDEN:
                return 'Forbidden';
            case HTTP_STATUS.NOT_FOUND:
                return 'Not Found';
            case HTTP_STATUS.METHOD_NOT_ALLOWED:
                return 'Method Not Allowed';
            case HTTP_STATUS.NOT_ACCEPTABLE:
                return 'Not Acceptable';
            case HTTP_STATUS.PROXY_AUTHENTICATION_REQUIRED:
                return 'Proxy Authentication Required';
            case HTTP_STATUS.REQUEST_TIMEOUT:
                return 'Request Timeout';
            case HTTP_STATUS.CONFLICT:
                return 'Conflict';
            case HTTP_STATUS.GONE:
                return 'Gone';
            case HTTP_STATUS.LENGTH_REQUIRED:
                return 'Length Required';
            case HTTP_STATUS.PRECONDITION_FAILED:
                return 'Precondition Failed';
            case HTTP_STATUS.PAYLOAD_TOO_LARGE:
                return 'Payload Too Large';
            case HTTP_STATUS.REQUEST_URI_TOO_LONG:
                return 'URI Too Long';
            case HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE:
                return 'Unsupported Media Type';
            case HTTP_STATUS.RANGE_NOT_SATISFIABLE:
                return 'Range Not Satisfiable';
            case HTTP_STATUS.EXPECTATION_FAILED:
                return 'Expectation Failed';
            case HTTP_STATUS.IM_A_TEAPOT:
                return "I'm a teapot";
            case HTTP_STATUS.MISDIRECTED_REQUEST:
                return 'Misdirected Request';
            case HTTP_STATUS.UNPROCESSABLE_ENTITY:
                return 'Unprocessable Entity';
            case HTTP_STATUS.LOCKED:
                return 'Locked';
            case HTTP_STATUS.FAILED_DEPENDENCY:
                return 'Failed Dependency';
            case HTTP_STATUS.UPGRADE_REQUIRED:
                return 'Upgrade Required';
            case HTTP_STATUS.PRECONDITION_REQUIRED:
                return 'Precondition Required';
            case HTTP_STATUS.TOO_MANY_REQUESTS:
                return 'Too Many Requests';
            case HTTP_STATUS.REQUEST_HEADER_FIELDS_TOO_LARGE:
                return 'Request Header Fields Too Large';
            case HTTP_STATUS.UNAVAILABLE_FOR_LEGAL_REASONS:
                return 'Unavailable For Legal Reasons';
            case HTTP_STATUS.INTERNAL_SERVER_ERROR:
                return 'Internal Server Error';
            case HTTP_STATUS.NOT_IMPLEMENTED:
                return 'Not Implemented';
            case HTTP_STATUS.BAD_GATEWAY:
                return 'Bad Gateway';
            case HTTP_STATUS.SERVICE_UNAVAILABLE:
                return 'Service Unavailable';
            case HTTP_STATUS.GATEWAY_TIMEOUT:
                return 'Gateway Timeout';
            case HTTP_STATUS.HTTP_VERSION_NOT_SUPPORTED:
                return 'HTTP Version Not Supported';
            case HTTP_STATUS.VARIANT_ALSO_NEGOTIATES:
                return 'Variant Also Negotiates';
            case HTTP_STATUS.INSUFFICIENT_STORAGE:
                return 'Insufficient Storage';
            case HTTP_STATUS.LOOP_DETECTED:
                return 'Loop Detected';
            case HTTP_STATUS.NOT_EXTENDED:
                return 'Not Extended';
            case HTTP_STATUS.NETWORK_AUTHENTICATION_REQUIRED:
                return 'Network Authentication Required';
            default:
                return 'Unknown';
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
            case 2:
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
        let { headers, connectTimeout, retryLimit, retryDelay, retryAfter, redirectLimit } = options; // eslint-disable-line prefer-const
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
        if (!isNaN(retryAfter = asInt(retryAfter))) {
            HTTP_RETRYAFTER = Math.max(retryAfter, 0) * 1000;
        }
        if (!isNaN(redirectLimit = asInt(redirectLimit)) && redirectLimit >= 0) {
            HTTP_REDIRECTLIMIT = redirectLimit;
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
            const encoding = item.encoding;
            if (encoding && encoding !== 'utf8') {
                if (encoding.startsWith('utf16')) {
                    item.encoding = 'utf16le';
                }
                else if (encoding !== 'latin1') {
                    item.encoding = 'utf8';
                }
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
    getLocalUri(data: FileProcessing) {
        return data.file.localUri || '';
    }
    getMimeType(data: FileProcessing) {
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
        if (file.sourceUTF8) {
            return file.sourceUTF8;
        }
        file.encoding ||= 'utf8';
        if (file.buffer) {
            return file.sourceUTF8 = file.buffer.toString(file.encoding);
        }
        if (uri ||= file.localUri) {
            try {
                return file.sourceUTF8 = fs.readFileSync(uri, file.encoding);
            }
            catch (err) {
                this.writeFail([ERR_MESSAGE.READ_FILE, uri], err, this.logType.FILE);
            }
        }
        return '';
    }
    setAssetContent(file: ExternalAsset, content: string, options?: AssetContentOptions) {
        const trailing = concatString(file.trailingContent);
        if (trailing) {
            content += trailing;
        }
        if (options) {
            const { localUri, bundleIndex = 0, bundleReplace } = options;
            if (bundleIndex > 0) {
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
                appending[bundleIndex - 1] = content;
                if (bundleReplace) {
                    replacing[bundleIndex - 1] = bundleReplace;
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
        const buffer = file.sourceUTF8 ? Buffer.from(file.sourceUTF8, file.encoding ||= 'utf8') : file.buffer;
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
    writeImage(document: StringOfArray, data: OutputFinalize) {
        for (const { instance } of this.Document) {
            if (instance.writeImage && this.hasDocument(instance, document) && instance.writeImage(data)) {
                return true;
            }
        }
        return false;
    }
    addCopy(data: FileProcessing, saveAs?: string, replace = true) {
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
    async findMime(data: FileProcessing, rename?: boolean) {
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
    async transformAsset(data: FileProcessing, parent?: ExternalAsset) {
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
    getHostProxy(host: IHttpHost, uri: string) {
        const proxy = this.httpProxy;
        return proxy && (!proxy.include && !proxy.exclude && !host.localhost || Array.isArray(proxy.include) && proxy.include.find(value => uri.startsWith(value)) || !proxy.include && Array.isArray(proxy.exclude) && !proxy.exclude.find(value => uri.startsWith(value))) ? proxy : null;
    }
    createHttpRequest(url: StringOfURL, options?: HttpRequestOptions): HttpRequest {
        if (typeof url === 'string') {
            url = new URL(url);
        }
        const credentials = formatCredentials(url);
        const host = HTTP_HOST[url.origin + credentials] ||= new HttpHost(url, credentials, this.httpVersion);
        return { ...options, host, url };
    }
    getHttpClient(uri: StringOfURL, options: HttpRequestOptions) {
        let host: Undef<IHttpHost>,
            url: Undef<URL>,
            method: Undef<string>,
            httpVersion: Undef<HttpVersionSupport>,
            headers: Undef<OutgoingHttpHeaders>,
            encoding: Undef<TextEncoding>,
            outStream: Undef<WriteStream>,
            timeout: Undef<number>,
            keepAliveTimeout: Undef<number>;
        if (options) {
            ({ host, url, method, httpVersion, headers, encoding, timeout, keepAliveTimeout, outStream } = options);
        }
        const getting = (method ||= 'GET') === 'GET';
        let v2: boolean;
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
        const checkEncoding = (response: IncomingMessage | ClientHttp2Stream, contentEncoding = '') => {
            const chunkSize = outStream && outStream.writableHighWaterMark;
            let pipeTo: Undef<Transform>;
            switch (contentEncoding.trim().toLowerCase()) {
                case 'gzip':
                    pipeTo = zlib.createGunzip({ chunkSize });
                    break;
                case 'br':
                    if (HTTP_BROTLISUPPORT) {
                        pipeTo = zlib.createBrotliDecompress({ chunkSize });
                    }
                    else {
                        request.emit('error', new Error('Unable to decompress Brotli encoding'));
                    }
                    break;
                case 'deflate':
                    pipeTo = zlib.createInflate({ chunkSize });
                    break;
            }
            if (pipeTo) {
                if (outStream) {
                    stream.pipeline(response, pipeTo, outStream, err => {
                        if (err) {
                            response.emit('error', err);
                        }
                    });
                }
                else {
                    stream.pipeline(response, pipeTo, err => {
                        if (err) {
                            response.emit('error', err);
                        }
                    });
                }
                return pipeTo;
            }
        };
        const origin = host.origin;
        const pathname = url.pathname + url.search;
        let request: HttpRequestClient,
            baseHeaders = getBaseHeaders(uri);
        if (getting) {
            if (this.useAcceptEncoding && !host.localhost && (!baseHeaders || !baseHeaders['accept-encoding'])) {
                (headers ||= {})['accept-encoding'] ||= 'gzip, deflate' + (HTTP_BROTLISUPPORT ? ', br' : '');
            }
        }
        if (v2) {
            let signal: Undef<PlainObject>;
            if (getting && options && this.supported(15, 4)) {
                const ac = new AbortController();
                signal = { signal: ac.signal };
                options.outAbort = ac;
            }
            request = (this._sessionHttp2[origin] ||= http2.connect(origin)).request({ ...baseHeaders, ...host.headers, ...headers, ':path': pathname, ':method': method }, signal);
            if (getting) {
                const listenerMap: ObjectMap<((...args: any[]) => void)[]> = {};
                let connected: Undef<boolean>,
                    emitter: Undef<Writable>;
                request.on('response', response => {
                    connected = true;
                    const statusCode = response[':status']!;
                    if (statusCode >= HTTP_STATUS.OK && statusCode < HTTP_STATUS.MULTIPLE_CHOICES) {
                        const source = checkEncoding(request as ClientHttp2Stream, response['content-encoding']);
                        if (source) {
                            emitter = source;
                            for (const event in listenerMap) {
                                listenerMap[event]!.forEach(listener => {
                                    request.removeListener(event, listener);
                                    emitter!.on(event === 'end' ? 'finish' : event, listener);
                                });
                            }
                        }
                        else {
                            if (outStream) {
                                stream.pipeline(request as ClientHttp2Stream, outStream, err => {
                                    if (err) {
                                        request.emit('error', err);
                                    }
                                });
                            }
                            if (encoding) {
                                (request as ClientHttp2Stream).setEncoding(encoding);
                            }
                        }
                        if (!this._connectHttp2[origin]) {
                            this._connectHttp2[origin] = 1;
                        }
                        else {
                            ++this._connectHttp2[origin]!;
                        }
                    }
                });
                const addListener = request.on.bind(request);
                request.on = function(this: ClientHttp2Stream, event: string, listener: (...args: any[]) => void) {
                    switch (event) {
                        case 'data':
                        case 'close':
                        case 'error':
                        case 'end':
                            if (emitter) {
                                emitter.on(event === 'end' ? 'finish' : event, listener);
                                break;
                            }
                            else if (!connected) {
                                (listenerMap[event] ||= []).push(listener);
                            }
                        default:
                            addListener(event, listener);
                            break;
                    }
                    return this;
                };
            }
            options.httpVersion = 2;
        }
        else {
            keepAliveTimeout ??= this.keepAliveTimeout;
            const proxy = this.httpProxy;
            let agent: Undef<Agent>;
            if (proxy && (!proxy.include && !proxy.exclude && !host.localhost || Array.isArray(proxy.include) && proxy.include.find(value => (uri as string).startsWith(value)) || !proxy.include && Array.isArray(proxy.exclude) && !proxy.exclude.find(value => (uri as string).startsWith(value)))) {
                const lib = host.secure ? 'https-proxy-agent' : 'http-proxy-agent';
                try {
                    const proxyHost = proxy.host;
                    const proxyUrl = proxyHost.toString();
                    agent = (require(lib) as FunctionType<Agent>)(keepAliveTimeout > 0 ? { protocol: proxyHost.protocol, hostname: proxyHost.hostname, port: proxyHost.port, keepAlive: true, timeout: keepAliveTimeout } : proxyUrl);
                    const proxyHeaders = getBaseHeaders(proxyUrl);
                    if (proxyHeaders) {
                        baseHeaders = { ...baseHeaders, ...proxyHeaders };
                    }
                }
                catch (err) {
                    this.writeFail([ERR_MESSAGE.INSTALL, 'npm i ' + lib], err);
                }
            }
            else if (keepAliveTimeout > 0) {
                agent = new (host.secure ? HttpAgent.HttpsAgent : HttpAgent)({ keepAlive: true, timeout: keepAliveTimeout, freeSocketTimeout: HTTP_CONNECTTIMEOUT });
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
            }, response => {
                const statusCode = response.statusCode!;
                if (getting && statusCode >= HTTP_STATUS.OK && statusCode < HTTP_STATUS.MULTIPLE_CHOICES) {
                    let source: Undef<IncomingMessage | Transform> = checkEncoding(response, response.headers['content-encoding']);
                    if (source) {
                        source.once('finish', () => request.emit('end'));
                    }
                    else {
                        if (encoding) {
                            response.setEncoding(encoding);
                        }
                        if (outStream) {
                            stream.pipeline(response, outStream, err => {
                                if (err) {
                                    request.emit('error', err);
                                }
                                else {
                                    request.emit('end');
                                }
                            });
                        }
                        else {
                            response.once('end', () => request.emit('end'));
                        }
                        source = response;
                    }
                    source
                        .on('data', chunk => request.emit('data', chunk))
                        .on('close', () => request.emit('close'))
                        .on('error', err => request.emit('error', err));
                    if (!this._connectHttp1[origin]) {
                        this._connectHttp1[origin] = 1;
                    }
                    else {
                        ++this._connectHttp1[origin]!;
                    }
                }
                else {
                    response
                        .on('close', () => request.emit('close'))
                        .on('error', err => request.emit('error', err))
                        .once('end', () => request.emit('end'));
                }
            });
            options.httpVersion = 1;
        }
        if (timeout !== 0) {
            request.setTimeout(timeout || HTTP_CONNECTTIMEOUT);
        }
        request.end();
        return request;
    }
    fetchBuffer(uri: StringOfURL, options?: HttpRequestOptions) {
        return new Promise<Null<BufferContent>>((resolve, reject) => {
            const pipeTo = options && options.pipeTo;
            let outStream: Undef<WriteStream>,
                closed: Undef<boolean>;
            const throwError = (err: Error) => {
                if (!closed) {
                    closed = true;
                    if (outStream) {
                        FileManager.cleanupStream(outStream, pipeTo);
                    }
                    reject(err);
                }
            };
            try {
                const time = Date.now();
                let retries = 0,
                    redirects = 0;
                (function downloadUri(this: IFileManager, href: StringOfURL, httpVersion?: HttpVersionSupport) {
                    const request = this.createHttpRequest(href, options);
                    if (outStream) {
                        FileManager.cleanupStream(outStream, pipeTo);
                    }
                    if (pipeTo) {
                        outStream = fs.createWriteStream(pipeTo, { highWaterMark: !request.host.localhost ? HTTP.CHUNK_SIZE : HTTP.CHUNK_SIZE_LOCAL });
                        request.outStream = outStream;
                    }
                    if (httpVersion) {
                        request.httpVersion = httpVersion;
                    }
                    const client = this.getHttpClient(href, request);
                    const { host, url, encoding } = request;
                    let buffer: Optional<BufferContent | Buffer[]>,
                        aborted: Undef<boolean>;
                    const isAborted = () => client.destroyed || host.v2() && (client as ClientHttp2Stream).aborted;
                    const isRetryable = (value: number) => isRetryStatus(value) && ++retries <= HTTP_RETRYLIMIT;
                    const isDowngrade = (err: unknown) => err instanceof Error && ((err as SystemError).code === 'ERR_HTTP2_ERROR' || Math.abs((err as SystemError).errno) === HTTP_STATUS.HTTP_VERSION_NOT_SUPPORTED);
                    const formatWarning = (message: string) => this.formatMessage(this.logType.HTTP, 'HTTP' + host.version, [message, host.origin], url.toString(), { titleColor: 'yellow', titleBgColor: 'bgGray' });
                    const formatNgFlags = (value: number, statusCode: number, location?: string) => location ? new Error(`Using HTTP 1.1 for URL redirect (${location})`) : formatStatusCode(statusCode, value ? 'NGHTTP2 Error ' + value : '');
                    const abortResponse = () => {
                        aborted = true;
                        if (!client.destroyed) {
                            const ac = request.outAbort;
                            if (ac) {
                                if (!client.aborted) {
                                    ac.abort();
                                }
                                delete request.outAbort;
                            }
                            else {
                                client.destroy();
                            }
                        }
                    };
                    const retryTimeout = () => {
                        formatWarning(`Connection timeout (${retries} / ${HTTP_RETRYLIMIT})`);
                        downloadUri.call(this, href);
                    };
                    const acceptResponse = (headers: IncomingHttpHeaders) => {
                        let buffering: Void<boolean>;
                        if (request.connected) {
                            buffering = request.connected.call(client, headers);
                        }
                        if (buffering !== false) {
                            client.on('data', data => {
                                if (typeof data === 'string') {
                                    if (buffer) {
                                        buffer += data;
                                    }
                                    else {
                                        buffer = data;
                                    }
                                }
                                else if (!buffer) {
                                    buffer = [data];
                                }
                                else if (typeof buffer === 'string') {
                                    buffer += Buffer.isBuffer(data) ? data.toString(encoding) : data;
                                }
                                else {
                                    (buffer as Buffer[]).push(data);
                                }
                            });
                        }
                        client.on('end', () => {
                            if (!closed) {
                                closed = true;
                                let titleBgColor: Undef<typeof BackgroundColor>;
                                if (buffer) {
                                    if (Array.isArray(buffer)) {
                                        buffer = Buffer.concat(buffer);
                                    }
                                    if (encoding && Buffer.isBuffer(buffer)) {
                                        buffer = buffer.toString(encoding);
                                    }
                                    if (typeof buffer === 'string' && buffer[0] === '\uFEFF' && (encoding === 'utf8' || encoding === 'utf16le')) {
                                        resolve(buffer.substring(1));
                                    }
                                    else {
                                        resolve(buffer);
                                    }
                                }
                                else {
                                    resolve(encoding ? '' : null);
                                    titleBgColor = 'bgBlue';
                                }
                                this.writeTimeProcess('HTTP' + host.version, request.statusMessage || url.toString(), time, { type: this.logType.HTTP, meterIncrement: 100, queue: true, titleBgColor });
                            }
                        });
                        host.success();
                    };
                    const redirectResponse = (location?: string) => {
                        abortResponse();
                        if (location) {
                            if (++redirects <= HTTP_REDIRECTLIMIT) {
                                downloadUri.call(this, getLocation(url, location));
                            }
                            else {
                                throwError(getRedirectError());
                            }
                        }
                        else {
                            throwError(formatStatusCode(HTTP_STATUS.NOT_FOUND, 'Redirect location was missing'));
                        }
                    };
                    const errorResponse = (err: Error) => {
                        abortResponse();
                        if (isRetryError(err)) {
                            if (++retries <= HTTP_RETRYLIMIT) {
                                if (isConnectionTimeout(err)) {
                                    retryTimeout();
                                }
                                else {
                                    setTimeout(downloadUri.bind(this), HTTP_RETRYDELAY);
                                }
                            }
                            else {
                                throwError(err);
                            }
                        }
                        else {
                            host.error();
                            throwError(err);
                        }
                    };
                    const retryResponse = (statusCode: number, retryAfter?: Undef<string>) => {
                        if (retryAfter && HTTP_RETRYAFTER > 0) {
                            let offset = +retryAfter || new Date(retryAfter);
                            if (offset instanceof Date) {
                                offset = Math.max(0, offset.getTime() - Date.now());
                            }
                            else {
                                offset *= 1000;
                            }
                            if (offset > 0) {
                                if (offset <= HTTP_RETRYAFTER) {
                                    formatWarning(`Retry After (${retryAfter})`);
                                    setTimeout(downloadUri.bind(this), offset);
                                }
                                else {
                                    abortResponse();
                                    throwError(formatStatusCode(statusCode));
                                }
                                return;
                            }
                        }
                        formatWarning(FileManager.fromHttpStatusCode(statusCode) + ` (${retries} / ${HTTP_RETRYLIMIT})`);
                        setTimeout(downloadUri.bind(this), isRetryStatus(statusCode, true) ? 0 : HTTP_RETRYDELAY);
                    };
                    if (request.httpVersion === 2) {
                        const retryDownload = (downgrade: boolean, err: Error) => {
                            if (!aborted) {
                                abortResponse();
                                buffer = null;
                                if (downgrade && host.version > 1) {
                                    this.formatMessage(this.logType.HTTP, 'HTTP' + host.version, ['Unsupported protocol', host.origin], err, { failed: true });
                                    host.failed();
                                    host.version = 1;
                                }
                                downloadUri.call(this, href, 1);
                            }
                        };
                        (client as ClientHttp2Stream)
                            .on('response', (headers, flags) => {
                                if (!isAborted()) {
                                    const statusCode = headers[':status']!;
                                    if (statusCode < HTTP_STATUS.MULTIPLE_CHOICES) {
                                        acceptResponse(headers);
                                    }
                                    else if (statusCode < HTTP_STATUS.BAD_REQUEST) {
                                        redirectResponse(headers.location);
                                    }
                                    else if (
                                        statusCode === HTTP_STATUS.UNAUTHORIZED ||
                                        statusCode === HTTP_STATUS.PAYMENT_REQUIRED ||
                                        statusCode === HTTP_STATUS.FORBIDDEN ||
                                        statusCode === HTTP_STATUS.NOT_FOUND ||
                                        statusCode === HTTP_STATUS.PROXY_AUTHENTICATION_REQUIRED ||
                                        statusCode === HTTP_STATUS.GONE)
                                    {
                                        throwError(formatStatusCode(statusCode));
                                    }
                                    else if (
                                        statusCode === HTTP_STATUS.MISDIRECTED_REQUEST ||
                                        statusCode === HTTP_STATUS.HTTP_VERSION_NOT_SUPPORTED)
                                    {
                                        retryDownload(true, formatNgFlags(http2.constants.NGHTTP2_PROTOCOL_ERROR, statusCode));
                                    }
                                    else if (isRetryable(statusCode)) {
                                        retryResponse(statusCode, headers['retry-after']);
                                    }
                                    else if (statusCode >= HTTP_STATUS.BAD_REQUEST) {
                                        if (HTTP2_UNSUPPORTED.includes(flags)) {
                                            retryDownload(true, formatNgFlags(flags, statusCode));
                                        }
                                        else {
                                            retryDownload(false, formatStatusCode(statusCode));
                                        }
                                    }
                                    else {
                                        retryDownload(false, formatNgFlags(0, statusCode, headers.location));
                                    }
                                }
                            })
                            .on('error', async err => {
                                if (!aborted) {
                                    if (await host.hasProtocol(2)) {
                                        errorResponse(err);
                                    }
                                    else {
                                        retryDownload(host.error() >= HTTP.MAX_ERROR || isDowngrade(err) || !isRetryError(err), err);
                                    }
                                }
                            });
                    }
                    else {
                        (client as ClientRequest)
                            .on('response', res => {
                                if (!isAborted()) {
                                    const statusCode = res.statusCode!;
                                    if (statusCode < HTTP_STATUS.MULTIPLE_CHOICES) {
                                        acceptResponse(res.headers);
                                    }
                                    else if (statusCode < HTTP_STATUS.BAD_REQUEST) {
                                        redirectResponse(res.headers.location);
                                    }
                                    else if (isRetryable(statusCode)) {
                                        retryResponse(statusCode, res.headers['retry-after']);
                                    }
                                    else {
                                        abortResponse();
                                        throwError(formatStatusCode(statusCode));
                                    }
                                }
                            })
                            .on('error', err => {
                                if (!aborted) {
                                    errorResponse(err);
                                }
                            });
                    }
                    client.on('timeout', () => {
                        if (!aborted) {
                            abortResponse();
                            if (++retries <= HTTP_RETRYLIMIT) {
                                retryTimeout();
                            }
                            else {
                                throwError(formatStatusCode(HTTP_STATUS.REQUEST_TIMEOUT));
                            }
                        }
                    });
                }).bind(this)(uri);
            }
            catch (err) {
                throwError(err);
            }
        });
    }
    processAssets(emptyDir?: boolean) {
        const processing: ObjectMap<ExternalAsset[]> = {};
        const downloading: ObjectMap<ExternalAsset[]> = {};
        const appending: ObjectMap<ExternalAsset[]> = {};
        const completed: string[] = [];
        const emptied: string[] = [];
        const { expires: bufferExpires, limit: bufferLimit } = this.cacheHttpRequestBuffer;
        const isCacheable = (file: ExternalAsset) => bufferLimit > 0 && (!file.contentLength || file.contentLength <= bufferLimit);
        const setHeaderData = (file: ExternalAsset, headers: IncomingHttpHeaders, lastModified?: boolean) => {
            let contentLength: Undef<NumString> = headers['content-length'];
            if (contentLength && !isNaN(contentLength = parseInt(contentLength))) {
                file.contentLength = contentLength;
            }
            if (file.etag = headers.etag) {
                return file.etag;
            }
            else if (lastModified && this.Watch) {
                return file.etag = headers['last-modified'];
            }
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
        const setTempBuffer = (uri: string, etag: string, buffer: BufferContent, contentLength = Buffer.byteLength(buffer), tempUri?: string) => {
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
                                        .on('error', () => resolve(file))
                                        .on('timeout', () => resolve(file));
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
        const verifyBundle = (file: ExternalAsset, localUri: string, value: Undef<BufferContent>, etag?: string) => {
            if (!file.invalid) {
                if (value) {
                    if (value instanceof Buffer) {
                        value = value.toString(file.encoding ||= 'utf8');
                    }
                    if (etag) {
                        setTempBuffer(file.uri!, encodeURIComponent(etag), value, file.contentLength);
                    }
                    this.setAssetContent(file, value, { localUri, bundleIndex: file.bundleIndex!, bundleReplace: file.bundleReplace });
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
                        const { uri, content } = queue;
                        if (content) {
                            verifyBundle(queue, localUri, content);
                        }
                        else if (uri) {
                            const encoding = queue.encoding ||= 'utf8';
                            const url = queue.url;
                            if (url) {
                                let etag = queue.etag,
                                    baseDir: Undef<string>,
                                    tempDir: Undef<string>,
                                    etagDir: Undef<string>,
                                    pipeTo: Undef<string>;
                                if (etag) {
                                    tempDir = createTempDir(url);
                                    etagDir = encodeURIComponent(etag);
                                    const cached = HTTP_BUFFER[uri];
                                    if (cached) {
                                        if (etagDir === cached[0]) {
                                            verifyBundle(queue, localUri, Buffer.isBuffer(cached[1]) ? cached[1].toString(encoding) : cached[1]);
                                            continue;
                                        }
                                        clearTempBuffer(uri, tempDir && path.join(tempDir, cached[0], path.basename(localUri)));
                                    }
                                    if (tempDir) {
                                        pipeTo = path.join(baseDir = path.join(tempDir, etagDir), path.basename(localUri));
                                        try {
                                            if (Module.hasSize(pipeTo)) {
                                                verifyBundle(queue, localUri, fs.readFileSync(pipeTo, { encoding }), etag);
                                                continue;
                                            }
                                            else if (!fs.existsSync(baseDir)) {
                                                fs.mkdirSync(baseDir);
                                            }
                                        }
                                        catch {
                                            pipeTo = undefined;
                                        }
                                    }
                                }
                                const options: HttpRequestOptions = {
                                    url,
                                    encoding,
                                    pipeTo,
                                    statusMessage: uri + ` (${queue.bundleIndex!})`,
                                    connected: (headers: IncomingHttpHeaders) => {
                                        etag = setHeaderData(queue, headers, true);
                                        return true;
                                    }
                                };
                                tasks.push(this.fetchBuffer(url, options)
                                    .then(data => {
                                        if (data) {
                                            verifyBundle(queue, localUri, data, etag);
                                        }
                                        else {
                                            queue.invalid = true;
                                        }
                                    })
                                    .catch(err => {
                                        queue.invalid = true;
                                        throw err;
                                    })
                                );
                            }
                            else if (Module.isFileUNC(uri) && this.permission.hasUNCRead(uri) || path.isAbsolute(uri) && this.permission.hasDiskRead(uri)) {
                                tasks.push(fs.readFile(uri, encoding)
                                    .then(data => verifyBundle(queue, localUri, data))
                                    .catch(err => {
                                        queue.invalid = true;
                                        throw err;
                                    })
                                );
                            }
                            else {
                                errorPermission(file);
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
                    const uriMap = new Map<string, ExternalAsset[]>();
                    for (const item of downloaded) {
                        const destUri = item.localUri!;
                        let items = uriMap.get(destUri);
                        if (!items) {
                            const pathname = path.dirname(destUri);
                            if (!Module.mkdirSafe(pathname)) {
                                item.invalid = true;
                                continue;
                            }
                            uriMap.set(destUri, items = []);
                        }
                        items.push(item);
                    }
                    const buffer = file.sourceUTF8 || file.buffer;
                    for (const [destUri, items] of uriMap) {
                        try {
                            if (buffer) {
                                fs.writeFileSync(destUri, buffer);
                            }
                            else {
                                fs.copyFileSync(localUri, destUri);
                            }
                            for (const queue of items) {
                                this.performAsyncTask();
                                this.transformAsset({ file: queue });
                            }
                        }
                        catch (err) {
                            for (const queue of items) {
                                queue.invalid = true;
                            }
                            this.writeFail([buffer ? ERR_MESSAGE.WRITE_BUFFER : ERR_MESSAGE.COPY_FILE, localUri], err, this.logType.FILE);
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
            this.completeAsyncTask();
            if (pipeTo) {
                FileManager.cleanupStream(pipeTo, localUri);
            }
            this.writeFail([ERR_MESSAGE.DOWNLOAD_FILE, uri], err);
        };
        const errorPermission = (file: ExternalAsset) => {
            const uri = file.uri!;
            this.writeFail([ERR_MESSAGE.READ_FILE, uri], new Error(`Insufficient permissions (${uri})`));
            file.invalid = true;
        };
        const createFolder = (file: ExternalAsset, pathname: string) => {
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
                    file.invalid = true;
                    return false;
                }
            }
            return true;
        };
        for (const item of this.assets) {
            if (!item.filename) {
                item.invalid = true;
                continue;
            }
            const { pathname, localUri } = this.setLocalUri(item);
            const fileReceived = (err?: NodeJS.ErrnoException) => {
                if (!err) {
                    processQueue(item, localUri);
                }
                else {
                    item.invalid = true;
                    this.completeAsyncTask(err, localUri);
                }
            };
            const uri = item.uri;
            if (item.content) {
                if (!checkQueue(item, localUri, true) && createFolder(item, pathname)) {
                    item.sourceUTF8 = item.content;
                    this.performAsyncTask();
                    fs.writeFile(localUri, item.content, item.encoding ||= 'utf8', err => fileReceived(err));
                }
            }
            else if (item.base64) {
                if (createFolder(item, pathname)) {
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
            else if (uri) {
                const url = item.url;
                if (url) {
                    if (!checkQueue(item, localUri)) {
                        if (downloading[uri]) {
                            downloading[uri]!.push(item);
                        }
                        else if (createFolder(item, pathname)) {
                            downloading[uri] = [];
                            this.performAsyncTask();
                            let client: Null<ClientRequest> = null;
                            const closeResponse = () => {
                                if (client && !client.destroyed) {
                                    client.destroy();
                                }
                            };
                            const downloadUri = (request: HttpRequest, tempDir?: string, etagDir?: string) => {
                                closeResponse();
                                const location = request.url.toString();
                                request.method = 'GET';
                                request.httpVersion = undefined;
                                request.encoding = item.encoding;
                                request.pipeTo = localUri;
                                request.statusMessage = location + (item.bundleIndex === 0 ? ' (0)' : '');
                                request.connected = headers => {
                                    setHeaderData(item, headers, true);
                                    return item.willChange || isCacheable(item);
                                };
                                this.fetchBuffer(request.url, request)
                                    .then(data => {
                                        if (data) {
                                            if (typeof data === 'string') {
                                                item.sourceUTF8 = data;
                                            }
                                            else {
                                                item.buffer = data;
                                            }
                                        }
                                        processQueue(item, localUri);
                                        if (etagDir) {
                                            if (tempDir) {
                                                const baseDir = path.join(tempDir, etagDir);
                                                const tempUri = path.join(baseDir, path.basename(localUri));
                                                try {
                                                    if (!fs.existsSync(baseDir)) {
                                                        fs.mkdirSync(baseDir);
                                                    }
                                                    if (data) {
                                                        if (bufferExpires > 0) {
                                                            setTempBuffer(location, etagDir, data, item.contentLength, tempUri);
                                                        }
                                                        fs.writeFile(tempUri, data);
                                                    }
                                                    else if (fs.statSync(localUri).size > 0) {
                                                        fs.copyFile(localUri, tempUri);
                                                    }
                                                }
                                                catch (err) {
                                                    this.writeFail([ERR_MESSAGE.WRITE_FILE, tempUri], err, this.logType.FILE);
                                                }
                                            }
                                            else if (bufferExpires > 0 && data) {
                                                setTempBuffer(location, etagDir, data, item.contentLength);
                                            }
                                        }
                                    })
                                    .catch(err => errorRequest(item, err));
                            };
                            if (this.cacheHttpRequest || bufferExpires > 0) {
                                let redirects = 0;
                                (function checkHeaders(this: IFileManager, file: ExternalAsset, href: URL) {
                                    const request = this.createHttpRequest(href, { method: 'HEAD', httpVersion: 1 });
                                    (client = this.getHttpClient(href, request) as ClientRequest)
                                        .on('response', res => {
                                            const statusCode = res.statusCode!;
                                            if (statusCode < HTTP_STATUS.MULTIPLE_CHOICES) {
                                                const etag = setHeaderData(file, res.headers);
                                                let tempDir: Undef<string>,
                                                    etagDir: Undef<string>;
                                                if (Module.isString(etag)) {
                                                    const location = href.toString();
                                                    const cached = HTTP_BUFFER[location];
                                                    let buffer: Undef<BufferContent>;
                                                    tempDir = createTempDir(href);
                                                    etagDir = encodeURIComponent(etag);
                                                    if (cached) {
                                                        const etagCache = cached[0];
                                                        if (etagDir === etagCache) {
                                                            buffer = cached[1];
                                                        }
                                                        else {
                                                            clearTempBuffer(location, tempDir && path.join(tempDir, etagCache, path.basename(localUri)));
                                                        }
                                                    }
                                                    const setBuffer = () => {
                                                        if (typeof buffer === 'string') {
                                                            file.sourceUTF8 = buffer;
                                                        }
                                                        else if (buffer) {
                                                            file.buffer = buffer;
                                                        }
                                                    };
                                                    const checkBuffer = () => {
                                                        if (buffer) {
                                                            setBuffer();
                                                            fs.writeFileSync(localUri, buffer);
                                                            fileReceived();
                                                            closeResponse();
                                                            return true;
                                                        }
                                                        return false;
                                                    };
                                                    try {
                                                        if (tempDir) {
                                                            const pipeAs = path.join(tempDir, etagDir, path.basename(localUri));
                                                            if (Module.hasSize(pipeAs)) {
                                                                if (!buffer && isCacheable(file)) {
                                                                    setTempBuffer(location, etagDir, buffer = fs.readFileSync(pipeAs, { encoding: file.encoding }), file.contentLength, pipeAs);
                                                                }
                                                                if (this.archiving || !Module.hasSameStat(pipeAs, localUri)) {
                                                                    if (buffer) {
                                                                        fs.writeFileSync(localUri, buffer);
                                                                    }
                                                                    else {
                                                                        fs.copyFileSync(pipeAs, localUri);
                                                                    }
                                                                }
                                                                if (file.willChange) {
                                                                    setBuffer();
                                                                }
                                                                fileReceived();
                                                                closeResponse();
                                                                return;
                                                            }
                                                            else if (checkBuffer()) {
                                                                try {
                                                                    fs.writeFileSync(pipeAs, buffer!);
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
                                                downloadUri(request, tempDir, etagDir);
                                            }
                                            else if (statusCode < HTTP_STATUS.BAD_REQUEST) {
                                                closeResponse();
                                                const location = res.headers.location;
                                                try {
                                                    if (location && ++redirects <= HTTP_REDIRECTLIMIT) {
                                                        checkHeaders.call(this, file, new URL(getLocation(href, location)));
                                                        return;
                                                    }
                                                }
                                                catch {
                                                }
                                                errorRequest(file, getRedirectError());
                                            }
                                            else {
                                                downloadUri(request);
                                            }
                                        })
                                        .on('error', err => {
                                            if (!client!.destroyed) {
                                                if (isRetryError(err)) {
                                                    downloadUri(request);
                                                }
                                                else {
                                                    request.host.error();
                                                    errorRequest(file, err);
                                                }
                                            }
                                        })
                                        .on('timeout', () => {
                                            if (!client!.destroyed) {
                                                downloadUri(request);
                                            }
                                        });
                                }).bind(this)(item, url);
                            }
                            else {
                                downloadUri(this.createHttpRequest(url));
                            }
                        }
                    }
                }
                else if (Module.isFileUNC(uri) && this.permission.hasUNCRead(uri) || path.isAbsolute(uri) && this.permission.hasDiskRead(uri)) {
                    if (!checkQueue(item, localUri) && createFolder(item, pathname) && (this.archiving || !Module.hasSameStat(uri, localUri))) {
                        this.performAsyncTask();
                        fs.copyFile(uri, localUri, err => fileReceived(err));
                    }
                }
                else {
                    errorPermission(item);
                }
            }
            else {
                item.invalid = true;
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
                    }
                    catch (err) {
                        if (!Module.isErrorCode(err, 'ENOENT')) {
                            this.writeFail([ERR_MESSAGE.DELETE_FILE, value], err, this.logType.FILE);
                            continue;
                        }
                    }
                    this.delete(value);
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
                    fs.writeFileSync(item.localUri!, item.sourceUTF8, item.encoding ||= 'utf8');
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