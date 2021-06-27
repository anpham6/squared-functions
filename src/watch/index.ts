import type { FileInfo, WatchInterval, WatchReload } from '../types/lib/squared';

import type { IFileManager, IPermission, IWatch } from '../types/lib';
import type { ExternalAsset } from '../types/lib/asset';
import type { PostFinalizeCallback } from '../types/lib/filemanager';
import type { FileWatch } from '../types/lib/watch';

import type { Server } from 'ws';

import Module from '../module';

import path = require('path');
import fs = require('fs');
import https = require('https');
import ws = require('ws');
import request = require('request');

type FileWatchMap = ObjectMap<Map<string, { data: FileWatch; timeout: [Null<NodeJS.Timeout>, number] }>>;

let HTTP_MAP: FileWatchMap = {};
let DISK_MAP: FileWatchMap = {};
let PORT_MAP: ObjectMap<Server> = {};
let SECURE_MAP: ObjectMap<Server> = {};
let WATCH_MAP: ObjectMap<number> = {};

const REGEXP_EXPIRES = /^(?:\s*([\d.]+)\s*w)?(?:\s*([\d.]+)\s*d)?(?:\s*([\d.]+)\s*h)?(?:\s*([\d.]+)\s*m)?(?:\s*([\d.]+)\s*s)?(?:\s*(\d+)\s*ms)?\s*$/;

function getPostFinalize(watch: FileWatch) {
    const { socketId, port } = watch;
    if (socketId && port) {
        const asset = watch.assets[0] as Undef<ExternalAsset>;
        const server = watch.secure ? SECURE_MAP[port] : PORT_MAP[port];
        if (asset && server) {
            return (files: FileInfo[], errors: string[]) => {
                const src = asset.cloudUrl || asset.relativeUri || '';
                const type = (asset.mimeType || '').replace(/[^A-Za-z\d/.+-]/g, '');
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
        for (const attr in item) {
            switch (attr) {
                case 'buffer':
                case 'sourceUTF8':
                case 'transforms':
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
                const h = 60 * 60 * 1000;
                let result = 0;
                if (match[1]) {
                    result += +match[1] * 7 * 24 * h || 0;
                }
                if (match[2]) {
                    result += +match[2] * 24 * h || 0;
                }
                if (match[3]) {
                    result += +match[3] * h || 0;
                }
                if (match[4]) {
                    result += +match[4] * 60 * 1000 || 0;
                }
                if (match[5]) {
                    result += +match[5] * 1000 || 0;
                }
                if (match[6]) {
                    result += +match[6];
                }
                if (result > 0) {
                    return result + start;
                }
            }
        }
        else if (value > 0) {
            return value * 1000 || 0;
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
            const { bundleId, uri, relativeUri } = item;
            if (bundleId) {
                (destMap[bundleId] ||= []).push(item);
            }
            else if (uri && relativeUri && !item.invalid) {
                (destMap[relativeUri] ||= []).push(item);
            }
        }
        for (let dest in destMap) {
            let items = destMap[dest]!;
            if (!items.some(item => item.watch)) {
                continue;
            }
            items = items.map(item => ({ ...item }));
            let watchInterval: Undef<number>;
            if (!isNaN(+dest)) {
                dest = items[0].relativeUri!;
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
                const { watch, uri, etag } = item;
                if (watch && uri) {
                    if (item.originalName) {
                        item.filename = item.originalName;
                        delete item.originalName;
                    }
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
                            let wss: Undef<Server>;
                            ({ port, module: hot } = reload);
                            if (reload.secure) {
                                port ||= this.securePort;
                                wss = SECURE_MAP[port];
                                if (!wss) {
                                    const sslKey = this._sslKey;
                                    const sslCert = this._sslCert;
                                    try {
                                        if (sslKey && sslCert) {
                                            const server = https.createServer({ key: fs.readFileSync(sslKey), cert: fs.readFileSync(sslCert) });
                                            server.listen(port);
                                            wss = new ws.Server({ server });
                                            SECURE_MAP[port] = wss;
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
                                wss = PORT_MAP[port] ||= new ws.Server({ port });
                            }
                            if (wss) {
                                wss.on('error', function(this: Server, err) {
                                    this.clients.forEach(client => client.send(JSON.stringify(err)));
                                });
                                wss.on('close', function(this: Server) {
                                    this.clients.forEach(client => client.terminate());
                                });
                            }
                        }
                    }
                    const data = {
                        uri,
                        etag,
                        assets,
                        start,
                        id,
                        interval,
                        socketId,
                        port,
                        secure,
                        hot,
                        expires
                    } as FileWatch;
                    if (Module.isFileHTTP(uri)) {
                        if (!etag) {
                            continue;
                        }
                        const previous = HTTP_MAP[uri]?.get(dest);
                        if (previous) {
                            if (id && previous.data.id === id || expires > previous.data.expires || expires === previous.data.expires && interval < previous.timeout[1]) {
                                clearInterval(previous.timeout[0]!);
                            }
                            else {
                                continue;
                            }
                        }
                        const options: request.CoreOptions = this.host ? this.host.createRequestAgentOptions(uri, { method: 'HEAD' }, expires ? expires - start : Infinity)! : { method: 'HEAD' };
                        const timeout = setInterval(() => {
                            request(uri, options)
                                .on('response', res => {
                                    const map = HTTP_MAP[uri];
                                    if (map) {
                                        for (const [target, input] of map) {
                                            const next = input.data;
                                            const expired = next.expires;
                                            if (!expired || Date.now() < expired) {
                                                const value = (res.headers.etag || res.headers['last-modified']) as string;
                                                if (value && value !== next.etag) {
                                                    next.etag = value;
                                                    this.modified(next);
                                                }
                                            }
                                            else if (expired) {
                                                map.delete(target);
                                                if (map.size === 0) {
                                                    watchExpired(HTTP_MAP, next);
                                                    clearInterval(timeout);
                                                }
                                            }
                                        }
                                    }
                                    else {
                                        clearInterval(timeout);
                                    }
                                })
                                .on('error', err => {
                                    this.writeFail(['Unable to watch', uri], err);
                                    delete HTTP_MAP[uri];
                                    clearInterval(timeout);
                                });
                        }, interval);
                        (HTTP_MAP[uri] ||= new Map()).set(dest, { data, timeout: [timeout, interval] });
                    }
                    else if (permission && (Module.isFileUNC(uri) && permission.hasUNCRead(uri) || path.isAbsolute(uri) && permission.hasDiskRead(uri))) {
                        const previous = DISK_MAP[uri]?.get(dest);
                        if (previous) {
                            if (id && previous.data.id === id || expires > previous.data.expires && previous.data.expires !== 0) {
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
                                this.writeFail(['Unable to stat file', uri], err);
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
                        continue;
                    }
                    this.formatMessage(this.logType.WATCH, 'WATCH', ['Start', interval + 'ms ' + (expires ? formatDate(expires) : 'never')], uri, { titleColor: 'blue' });
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
            this.writeFail(['Unable to resolve file', value], err, this.logType.FILE);
        }
    }
    setSSLCert(value: string) {
        try {
            if (path.isAbsolute(value) && fs.existsSync(value)) {
                this._sslCert = value;
            }
        }
        catch (err) {
            this.writeFail(['Unable to resolve file', value], err, this.logType.FILE);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Watch;
    module.exports.default = Watch;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Watch;