import type { FileInfo, WatchInterval, WatchReload } from '../types/lib/squared';

import type { IFileManager, IPermission, IWatch } from '../types/lib';
import type { ExternalAsset } from '../types/lib/asset';
import type { PostFinalizeCallback } from '../types/lib/filemanager';
import type { FileWatch } from '../types/lib/watch';

import type { ClientRequest } from 'http';
import type { Server } from 'ws';

import { ERR_MESSAGE } from '../types/lib/logger';

import Module from '../module';

import path = require('path');
import fs = require('fs');
import https = require('https');
import ws = require('ws');
import request = require('request');

import { HTTP_STATUS, formatStatusCode, isConnectionTimeout } from '../file-manager';

type FileWatchMap = ObjectMap<Map<string, { data: FileWatch; timeout: [Null<NodeJS.Timeout>, number] }>>;

let HTTP_MAP: FileWatchMap = {};
let DISK_MAP: FileWatchMap = {};
let PORT_MAP: ObjectMap<Server> = {};
let SECURE_MAP: ObjectMap<Server> = {};
let WATCH_MAP: ObjectMap<number> = {};

const enum TIME { // eslint-disable-line no-shadow
    W = 1000 * 60 * 60 * 24 * 7,
    D = 1000 * 60 * 60 * 24,
    H = 1000 * 60 * 60,
    M = 1000 * 60,
    S = 1000
}

const enum ERR { // eslint-disable-line no-shadow
    ETAG = 1,
    LOCAL_ACCESS = 2,
    TIMEOUT_LIMIT = 10
}

const REGEXP_EXPIRES = /^(?:\s*([\d.]+)\s*w)?(?:\s*([\d.]+)\s*d)?(?:\s*([\d.]+)\s*h)?(?:\s*([\d.]+)\s*m)?(?:\s*([\d.]+)\s*s)?(?:\s*(\d+)\s*ms)?\s*$/;

function getPostFinalize(watch: FileWatch) {
    const { socketId, port } = watch;
    if (socketId && port) {
        const asset = watch.assets[0] as Undef<ExternalAsset>;
        const server = watch.secure ? SECURE_MAP[port] : PORT_MAP[port];
        if (asset && server) {
            return (files: FileInfo[], errors: string[]) => {
                const src = asset.cloudUrl || asset.relativeUri || '';
                const type = asset.mimeType ? asset.mimeType.toLowerCase().replace(/[^a-z\d/.+-]/g, '') : '';
                const hot = watch.hot && src && (type === 'text/css' || type.startsWith('image/')) ? (src.indexOf('?') !== -1 ? '&' : '?') + 'q=' + Date.now() : '';
                const data = JSON.stringify({ socketId, module: 'watch', action: 'modified', src, type, hot, errors });
                server.clients.forEach(client => client.readyState === ws.OPEN && client.send(data));
            };
        }
    }
}

function getInterval(file: ExternalAsset) {
    const watch = file.watch;
    return Math.max(Module.isObject<WatchInterval>(watch) && watch.interval || 0, 0);
}

function clearCache(items: ExternalAsset[]) {
    for (const item of items) {
        if (item.originalName) {
            item.filename = item.originalName;
        }
        for (const attr in item) {
            switch (attr) {
                case 'originalName':
                case 'buffer':
                case 'sourceUTF8':
                case 'sourceFiles':
                case 'transforms':
                case 'etag':
                case 'contentLength':
                case 'watch':
                case 'invalid':
                    delete item[attr];
                    break;
            }
        }
    }
}

const formatDate = (value: number) => new Date(value).toLocaleString().replace(/\/20\d+, /, '@').replace(/:\d+ (AM|PM)$/, (...match) => match[1]);

class Watch extends Module implements IWatch {
    static parseExpires(value: NumString, start = 0) {
        if (Module.isString(value)) {
            const match = REGEXP_EXPIRES.exec(value);
            if (match) {
                let result = 0;
                if (match[1]) {
                    result += +match[1] * TIME.W || 0;
                }
                if (match[2]) {
                    result += +match[2] * TIME.D || 0;
                }
                if (match[3]) {
                    result += +match[3] * TIME.H || 0;
                }
                if (match[4]) {
                    result += +match[4] * TIME.M || 0;
                }
                if (match[5]) {
                    result += +match[5] * TIME.S || 0;
                }
                if (match[6]) {
                    result += +match[6];
                }
                if (result > 0) {
                    return Math.ceil(result + start);
                }
            }
        }
        else if (value > 0) {
            return Math.ceil(value * TIME.S);
        }
        return 0;
    }

    static shutdown() {
        for (const item of [HTTP_MAP, DISK_MAP]) {
            for (const uri in item) {
                for (const { timeout } of item[uri]!.values()) {
                    if (timeout[0]) {
                        clearInterval(timeout[0]);
                    }
                }
            }
        }
        for (const item of [PORT_MAP, SECURE_MAP]) {
            for (const port in item) {
                try {
                    item[port]!.close();
                }
                catch (err) {
                    this.writeFail([`Unable to shutdown ${item === PORT_MAP ? 'WS' : 'WSS'} server`, 'Port: ' + port], err);
                }
            }
        }
        HTTP_MAP = {};
        DISK_MAP = {};
        PORT_MAP = {};
        SECURE_MAP = {};
        WATCH_MAP = {};
    }

    static hasLocalAccess(permission: IPermission, uri: unknown) {
        return Module.isString(uri) && (Module.isFileUNC(uri) && permission.hasUNCRead(uri) || path.isAbsolute(uri) && permission.hasDiskRead(uri));
    }

    moduleName = 'watch';
    host?: IFileManager;

    private _sslKey = '';
    private _sslCert = '';

    constructor(public interval = 500, public port = 80, public securePort = 443) {
        super();
    }

    whenModified?: (assets: ExternalAsset[], postFinalize?: PostFinalizeCallback) => void;

    start(assets: ExternalAsset[], permission?: IPermission) {
        const destMap: ObjectMap<ExternalAsset[]> = {};
        for (const item of assets) {
            const { bundleId, uri, localUri } = item;
            if (bundleId) {
                (destMap[bundleId] ||= []).push(item);
            }
            else if (uri && localUri && !item.invalid) {
                (destMap[localUri] ||= []).push(item);
            }
        }
        for (let dest in destMap) {
            let items = destMap[dest]!;
            if (!items.some(item => item.watch)) {
                continue;
            }
            items = items.map(item => ({ ...item }));
            let watchInterval: Undef<number>,
                bundleMain: Undef<ExternalAsset>;
            if (!isNaN(+dest)) {
                items.sort((a, b) => a.bundleIndex! - b.bundleIndex!);
                bundleMain = items[0];
                dest = bundleMain.localUri!;
                const leading = items.find(item => getInterval(item) > 0);
                if (leading) {
                    watchInterval = getInterval(leading);
                }
            }
            const related = new Set(items);
            for (const item of items) {
                const watch = item.watch;
                if (Module.isObject<WatchInterval<ExternalAsset>>(watch) && watch.assets) {
                    watch.assets.forEach(other => related.add(other));
                }
            }
            assets = Array.from(related);
            for (const item of items) {
                let { watch, uri: file, etag } = item; // eslint-disable-line prefer-const
                if (watch && file) {
                    const start = Date.now();
                    const interval = getInterval(item) || watchInterval || this.interval;
                    const watchExpired = (map: FileWatchMap, input: FileWatch, message = 'Expired') => {
                        this.formatMessage(this.logType.WATCH, 'WATCH', [message, 'since ' + formatDate(input.start)], input.uri, { titleColor: 'grey' });
                        delete map[input.uri];
                    };
                    let expires = 0,
                        id: Undef<string>,
                        port: Undef<number>,
                        socketId: Undef<string>,
                        secure: Undef<boolean>,
                        hot: Undef<boolean>;
                    if (typeof watch === 'object') {
                        id = watch.id;
                        if (watch.expires) {
                            expires = Watch.parseExpires(watch.expires, start);
                        }
                        const reload = watch.reload;
                        if (Module.isObject<WatchReload>(reload) && (socketId = reload.socketId)) {
                            let wss: Undef<Server>,
                                initialize: Undef<boolean>;
                            ({ port, module: hot } = reload);
                            if (reload.secure) {
                                port ||= this.securePort;
                                if (!(wss = SECURE_MAP[port])) {
                                    const sslKey = this._sslKey;
                                    const sslCert = this._sslCert;
                                    try {
                                        if (sslKey && sslCert) {
                                            const server = https.createServer({ key: fs.readFileSync(sslKey), cert: fs.readFileSync(sslCert) });
                                            server.listen(port);
                                            wss = new ws.Server({ server });
                                            SECURE_MAP[port] = wss;
                                            initialize = true;
                                        }
                                        else {
                                            this.writeFail('SSL/TSL key and cert not found', new Error(`Missing SSL/TSL credentials (${socketId})`));
                                        }
                                    }
                                    catch (err) {
                                        this.writeFail('Unable to start WSS secure server', err);
                                    }
                                }
                                secure = true;
                            }
                            else {
                                port ||= this.port;
                                if (!(wss = PORT_MAP[port])) {
                                    wss = new ws.Server({ port });
                                    PORT_MAP[port] = wss;
                                    initialize = true;
                                }
                            }
                            if (wss && initialize) {
                                wss.on('error', function(this: Server, err) {
                                    this.clients.forEach(client => client.send(JSON.stringify(err)));
                                });
                                wss.on('close', function(this: Server) {
                                    this.clients.forEach(client => client.terminate());
                                });
                            }
                        }
                    }
                    let invalid = 0,
                        files: string[];
                    if (item.sourceFiles && permission && Watch.hasLocalAccess(permission, item.sourceFiles[0])) {
                        files = item.sourceFiles;
                        etag = '';
                    }
                    else {
                        files = [file];
                    }
                    for (const uri of files) {
                        const data = {
                            uri,
                            etag,
                            assets,
                            bundleMain,
                            start,
                            id,
                            interval,
                            socketId,
                            port,
                            secure,
                            hot,
                            expires
                        } as FileWatch;
                        const checkBundle = (watchMain: Undef<ExternalAsset>) => {
                            if (bundleMain && watchMain) {
                                if ((bundleMain.format || '') !== (watchMain.format || '') || JSON.stringify(bundleMain.commands || '') !== JSON.stringify(watchMain.commands || '')) {
                                    return true;
                                }
                            }
                            else if (bundleMain && !watchMain || !bundleMain && watchMain) {
                                return true;
                            }
                            return false;
                        };
                        if (Module.isFileHTTP(uri)) {
                            if (!etag) {
                                invalid = ERR.ETAG;
                                continue;
                            }
                            const previous = HTTP_MAP[uri]?.get(dest);
                            if (previous) {
                                const watchData = previous.data;
                                if (id && watchData.id === id || expires > watchData.expires || checkBundle(watchData.bundleMain) || expires === watchData.expires && interval < previous.timeout[1]) {
                                    clearInterval(previous.timeout[0]!);
                                }
                                else {
                                    continue;
                                }
                            }
                            const host = this.host;
                            const url = host && new URL(uri);
                            const writeError = (err: Error) => {
                                this.writeFail([ERR_MESSAGE.WATCH_FILE, uri], err);
                                delete HTTP_MAP[uri];
                            };
                            let retries = 0,
                                pending = false;
                            const timer = setInterval(() => {
                                if (pending) {
                                    return;
                                }
                                const timeout = interval * 5;
                                const options = url && host!.createHttpRequest(url, { method: 'HEAD', httpVersion: 1, timeout, keepAliveTimeout: timeout * 2 });
                                pending = true;
                                ((options ? host!.getHttpClient(uri, options) : request(uri, { method: 'HEAD', timeout })) as ClientRequest)
                                    .on('response', res => {
                                        const statusCode = res.statusCode!;
                                        const map = HTTP_MAP[uri];
                                        if (map && statusCode >= HTTP_STATUS.OK && statusCode < HTTP_STATUS.MULTIPLE_CHOICES) {
                                            for (const [target, input] of map) {
                                                const next = input.data;
                                                const expired = next.expires;
                                                if (!expired || Date.now() < expired) {
                                                    const value = res.headers.etag || res.headers['last-modified'];
                                                    if (value && value !== next.etag) {
                                                        next.etag = value;
                                                        this.modified(next);
                                                    }
                                                }
                                                else if (expired) {
                                                    map.delete(target);
                                                    if (map.size === 0) {
                                                        watchExpired(HTTP_MAP, next);
                                                        clearInterval(timer);
                                                    }
                                                }
                                            }
                                        }
                                        else {
                                            if (map) {
                                                writeError(formatStatusCode(statusCode));
                                            }
                                            clearInterval(timer);
                                        }
                                        pending = false;
                                    })
                                    .on('error', err => {
                                        if (isConnectionTimeout(err) && ++retries <= ERR.TIMEOUT_LIMIT) {
                                            return;
                                        }
                                        writeError(err);
                                        clearInterval(timer);
                                        pending = false;
                                    })
                                    .on('timeout', () => {
                                        if (++retries > ERR.TIMEOUT_LIMIT) {
                                            writeError(formatStatusCode(HTTP_STATUS.REQUEST_TIMEOUT));
                                            clearInterval(timer);
                                        }
                                        pending = false;
                                    });
                            }, interval);
                            (HTTP_MAP[uri] ||= new Map()).set(dest, { data, timeout: [timer, interval] });
                        }
                        else if (permission && Watch.hasLocalAccess(permission, uri)) {
                            const previous = DISK_MAP[uri]?.get(dest);
                            if (previous) {
                                const watchData = previous.data;
                                if (id && watchData.id === id || expires > watchData.expires && watchData.expires !== 0 || checkBundle(watchData.bundleMain)) {
                                    clearTimeout(previous.timeout[0]!);
                                }
                                else {
                                    continue;
                                }
                            }
                            let timeout: Null<NodeJS.Timeout> = null;
                            const watcher = fs.watch(uri, (event, filename) => {
                                try {
                                    switch (event) {
                                        case 'change': {
                                            const disk = DISK_MAP[uri];
                                            if (disk) {
                                                const mtime = Math.floor(fs.statSync(uri).mtimeMs);
                                                const ptime = WATCH_MAP[uri] || 0;
                                                if (mtime > ptime) {
                                                    for (const input of disk.values()) {
                                                        this.modified(input.data);
                                                    }
                                                    WATCH_MAP[uri] = Math.ceil(fs.statSync(uri).mtimeMs);
                                                }
                                            }
                                            break;
                                        }
                                        case 'rename':
                                            if (timeout) {
                                                clearTimeout(timeout);
                                            }
                                            watcher.close();
                                            watchExpired(DISK_MAP, data, 'File renamed: ' + filename);
                                            break;
                                    }
                                }
                                catch (err) {
                                    this.writeFail([ERR_MESSAGE.READ_FILE, uri], err);
                                }
                            });
                            if (expires) {
                                timeout = setTimeout(() => {
                                    watcher.close();
                                    watchExpired(DISK_MAP, data);
                                }, expires - start);
                            }
                            (DISK_MAP[uri] ||= new Map()).set(dest, { data, timeout: [timeout, Infinity] });
                        }
                        else {
                            invalid = ERR.LOCAL_ACCESS;
                            continue;
                        }
                    }
                    if (invalid) {
                        this.formatFail(this.logType.WATCH, 'WATCH', [ERR_MESSAGE.WATCH_FILE, file], new Error((invalid === ERR.LOCAL_ACCESS ? 'No read permission' : 'ETag unavailable') + ` (${file})`));
                    }
                    else {
                        this.formatMessage(this.logType.WATCH, 'WATCH', ['Start', interval + 'ms ' + (expires ? formatDate(expires) : 'never')], file, { titleColor: 'blue' });
                    }
                }
            }
        }
    }
    modified(watch: FileWatch) {
        this.formatMessage(this.logType.WATCH, 'WATCH', 'File modified', watch.uri, { titleColor: 'yellow' });
        if (this.whenModified) {
            clearCache(watch.assets);
            this.whenModified(watch.assets, getPostFinalize(watch));
        }
    }
    setSSLKey(value: string) {
        try {
            if (path.isAbsolute(value) && fs.existsSync(value)) {
                this._sslKey = value;
            }
        }
        catch (err) {
            this.writeFail([ERR_MESSAGE.RESOLVE_FILE, value], err, this.logType.FILE);
        }
    }
    setSSLCert(value: string) {
        try {
            if (path.isAbsolute(value) && fs.existsSync(value)) {
                this._sslCert = value;
            }
        }
        catch (err) {
            this.writeFail([ERR_MESSAGE.RESOLVE_FILE, value], err, this.logType.FILE);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Watch;
    module.exports.default = Watch;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Watch;