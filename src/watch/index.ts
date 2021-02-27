import type { IPermission, IWatch } from '../types/lib';
import type { ExternalAsset } from '../types/lib/asset';
import type { FileWatch } from '../types/lib/watch';

import type { Server } from 'ws';

import Module from '../module';

import path = require('path');
import fs = require('fs');
import request = require('request');

import WebSocket = require('ws');

type FileWatchMap = ObjectMap<Map<string, { data: FileWatch; timeout: [Null<NodeJS.Timeout>, number] }>>;

const HTTP_MAP: FileWatchMap = {};
const DISK_MAP: FileWatchMap = {};
const PORT_MAP: ObjectMap<Server> = {};

function getPostFinalize(watch: FileWatch) {
    const { socketId, port } = watch;
    if (socketId && port) {
        const server = PORT_MAP[port];
        if (server) {
            return (errors: string[]) => {
                const data = JSON.stringify({ socketId: watch.socketId, module: 'watch', type: 'modified', errors });
                for (const client of server.clients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(data);
                    }
                }
            };
        }
    }
}

const getInterval = (file: ExternalAsset) => Math.max(typeof file.watch === 'object' && file.watch.interval || 0, 0);
const formatDate = (value: number) => new Date(value).toLocaleString().replace(/\/20\d+, /, '@').replace(/:\d+ (AM|PM)$/, (...match) => match[1]);

class Watch extends Module implements IWatch {
    constructor(public interval = 200, public port = 8080) {
        super();
    }

    whenModified?: (assets: ExternalAsset[], postFinalize?: FunctionType<void>) => void;

    start(assets: ExternalAsset[], permission?: IPermission) {
        const destMap: ObjectMap<ExternalAsset[]> = {};
        for (const item of assets) {
            if (!item.invalid) {
                const { bundleId, uri, relativeUri } = item;
                if (bundleId) {
                    (destMap[bundleId] ||= []).push(item);
                }
                else if (uri && relativeUri) {
                    (destMap[relativeUri] ||= []).push(item);
                }
            }
        }
        for (let dest in destMap) {
            let items = destMap[dest];
            if (!items.some(item => item.watch)) {
                continue;
            }
            items = items.map(item => ({ ...item }));
            let leading: Undef<ExternalAsset>;
            if (!isNaN(+dest)) {
                dest = items[0].relativeUri!;
                leading = items.find(item => getInterval(item) > 0);
            }
            const watchInterval = leading ? getInterval(leading) : 0;
            for (const item of items) {
                const { watch, uri, etag } = item;
                if (watch && uri) {
                    if (item.originalName) {
                        item.filename = item.originalName;
                        delete item.originalName;
                    }
                    for (const attr in item) {
                        switch (attr) {
                            case 'buffer':
                            case 'sourceUTF8':
                            case 'transforms':
                            case 'invalid':
                                delete item[attr];
                                break;
                            default:
                                if (attr.startsWith('inline')) {
                                    delete item[attr];
                                }
                                break;
                        }
                    }
                    const start = Date.now();
                    const interval = getInterval(item) || watchInterval || this.interval;
                    const watchExpired = (map: FileWatchMap, input: FileWatch, message = 'Expired') => {
                        this.formatMessage(this.logType.WATCH, 'WATCH', [message, 'since ' + formatDate(input.start)], input.uri, { titleColor: 'grey' });
                        delete map[input.uri];
                    };
                    let expires = 0,
                        port: Undef<number>,
                        socketId: Undef<string>;
                    if (typeof watch === 'object') {
                        if (watch.expires) {
                            const match = /^\s*(?:([\d.]+)\s*h)?(?:\s*([\d.]+)\s*m)?(?:\s*([\d.]+)\s*s)?\s*$/i.exec(watch.expires);
                            if (match) {
                                if (match[1]) {
                                    expires += parseFloat(match[1]) * 1000 * 60 * 60;
                                }
                                if (match[2]) {
                                    expires += parseFloat(match[2]) * 1000 * 60;
                                }
                                if (match[3]) {
                                    expires += parseFloat(match[3]) * 1000;
                                }
                                if (!isNaN(expires) && expires > 0) {
                                    expires += start;
                                }
                            }
                        }
                        const reload = watch.reload;
                        if (typeof reload === 'object' && (socketId = reload.socketId)) {
                            port = reload.port || this.port;
                            PORT_MAP[port] ||= new WebSocket.Server({ port })
                                .on('error', function(this: Server, err) {
                                    for (const client of this.clients) {
                                        client.send(JSON.stringify(err));
                                    }
                                })
                                .on('close', function(this: Server) {
                                    for (const client of this.clients) {
                                        client.terminate();
                                    }
                                });
                        }
                    }
                    const data = {
                        uri,
                        etag,
                        assets: items,
                        start,
                        interval,
                        socketId,
                        port,
                        expires
                    } as FileWatch;
                    if (Module.isFileHTTP(uri)) {
                        if (!etag) {
                            continue;
                        }
                        const http = HTTP_MAP[uri];
                        const previous = http?.get(dest);
                        if (previous) {
                            if (expires > previous.data.expires || expires === previous.data.expires && interval < previous.timeout[1]) {
                                clearInterval(previous.timeout[0]!);
                            }
                            else {
                                return;
                            }
                        }
                        const timeout = setInterval(() => {
                            request(uri, { method: 'HEAD' })
                                .on('response', res => {
                                    const map = HTTP_MAP[uri];
                                    if (map) {
                                        for (const [target, input] of map) {
                                            const next = input.data;
                                            const expired = next.expires;
                                            if (!expired || Date.now() < expired) {
                                                const value = (res.headers['etag'] || res.headers['last-modified']) as string;
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
                    else if (permission && (permission.hasUNCRead() && Module.isFileUNC(uri) || permission.hasDiskRead() && path.isAbsolute(uri))) {
                        const previous = DISK_MAP[uri]?.get(dest);
                        if (previous) {
                            if (expires > previous.data.expires && previous.data.expires !== 0) {
                                clearTimeout(previous.timeout[0]!);
                            }
                            else {
                                return;
                            }
                        }
                        let timeout: Null<NodeJS.Timeout> = null;
                        if (expires) {
                            timeout = setTimeout(() => {
                                watcher.close();
                                watchExpired(DISK_MAP, data);
                            }, expires - start);
                        }
                        const watcher = fs.watch(uri, (event, filename) => {
                            switch (event) {
                                case 'change':
                                    for (const input of DISK_MAP[uri].values()) {
                                        this.modified(input.data);
                                    }
                                    break;
                                case 'rename':
                                    if (timeout) {
                                        clearTimeout(timeout);
                                    }
                                    watcher.close();
                                    watchExpired(DISK_MAP, data, 'File renamed: ' + filename);
                                    break;
                            }
                        });
                        (DISK_MAP[uri] ||= new Map()).set(dest, { data, timeout: [timeout, Infinity] });
                    }
                    else {
                        continue;
                    }
                    this.formatMessage(this.logType.WATCH, 'WATCH', ['Start', `${interval}ms ${expires ? formatDate(expires) : 'never'}`], uri, { titleColor: 'blue' });
                }
            }
        }
    }
    modified(watch: FileWatch) {
        if (this.whenModified) {
            this.whenModified(watch.assets, getPostFinalize(watch));
        }
        this.formatMessage(this.logType.WATCH, 'WATCH', 'File modified', watch.uri, { titleColor: 'yellow' });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Watch;
    module.exports.default = Watch;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Watch;