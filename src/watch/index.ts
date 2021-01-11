import type { ExternalAsset, INode, IWatch } from '../types/lib';

import Module from '../module';

import path = require('path');
import fs = require('fs');
import request = require('request');

interface FileWatch {
    uri: string;
    assets: ExternalAsset[];
    start: number;
    expires: number;
    interval: number;
    etag?: string;
}

type FileWatchMap = ObjectMap<Map<string, FileWatch>>;

const DISK_MAP: FileWatchMap = {};
const HTTP_MAP: FileWatchMap = {};
const TIMER_MAP: ObjectMap<[NodeJS.Timeout, number]> = {};

const getInterval = (file: ExternalAsset) => Math.max(typeof file.watch === 'object' && file.watch.interval || 0, 0);
const formatDate = (value: number) => new Date(value).toLocaleString().replace(/\/20\d+, /, '@').replace(/:\d+ (AM|PM)$/, (...match) => match[1]);

class Watch extends Module implements IWatch {
    public whenModified?: (assets: ExternalAsset[]) => void;

    constructor(public Node: INode, public interval = 200) {
        super();
    }

    start(assets: ExternalAsset[]) {
        const Node = this.Node;
        const destMap: ObjectMap<ExternalAsset[]> = {};
        for (const item of assets) {
            const { uri, relativeUri } = item;
            if (uri && relativeUri) {
                (destMap[relativeUri] ||= []).push(item);
            }
        }
        for (const dest in destMap) {
            let items = destMap[dest];
            if (!items.some(item => item.watch)) {
                continue;
            }
            items = items.map(item => ({ ...item }));
            items.sort((a, b) => {
                if (a.bundleId && !b.bundleId) {
                    return -1;
                }
                if (!a.bundleId && b.bundleId) {
                    return 1;
                }
                return 0;
            });
            const leading = items.find(item => item.bundleId && getInterval(item) > 0);
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
                    const fileModified = (input: FileWatch) => this.formatMessage(this.logType.WATCH, 'WATCH', 'File modified', input.uri, { titleColor: 'yellow' });
                    const watchExpired = (map: FileWatchMap, input: FileWatch, message = 'Expired') => {
                        this.formatMessage(this.logType.WATCH, 'WATCH', [message, 'since ' + formatDate(input.start)], input.uri, { titleColor: 'grey' });
                        delete map[input.uri];
                    };
                    let expires = 0;
                    if (typeof watch === 'object' && watch.expires) {
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
                    const data = {
                        uri,
                        etag,
                        assets: items,
                        start,
                        interval,
                        expires
                    } as FileWatch;
                    if (Node.isFileURI(uri)) {
                        if (!etag) {
                            continue;
                        }
                        const http = HTTP_MAP[uri];
                        const timer = TIMER_MAP[uri];
                        if (http && http.size && timer && interval <= timer[1]) {
                            http.set(dest, data);
                        }
                        else {
                            if (timer) {
                                clearInterval(timer[0]);
                            }
                            const timeout = setInterval(() => {
                                request(uri, { method: 'HEAD' })
                                    .on('response', res => {
                                        const map = HTTP_MAP[uri];
                                        for (const [output, input] of map) {
                                            if (!input.expires || Date.now() < input.expires) {
                                                const value = (res.headers['etag'] || res.headers['last-modified']) as string;
                                                if (value && value !== input.etag) {
                                                    input.etag = value;
                                                    if (this.whenModified) {
                                                        this.whenModified(input.assets);
                                                    }
                                                    fileModified(input);
                                                }
                                            }
                                            else if (input.expires) {
                                                map.delete(output);
                                                if (map.size === 0) {
                                                    watchExpired(HTTP_MAP, input);
                                                    clearInterval(timeout);
                                                }
                                            }
                                        }
                                    })
                                    .on('error', err => {
                                        HTTP_MAP[uri].clear();
                                        clearInterval(timeout);
                                        this.writeFail(['Unable to watch', uri], err);
                                    });
                            }, interval);
                            (HTTP_MAP[uri] ||= new Map()).set(dest, data);
                            TIMER_MAP[uri] = [timeout, interval];
                        }
                    }
                    else if (Node.hasUNCRead() && Node.isFileUNC(uri) || Node.hasDiskRead() && path.isAbsolute(uri)) {
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
                                        if (this.whenModified) {
                                            this.whenModified(input.assets);
                                        }
                                        fileModified(input);
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
                        (DISK_MAP[uri] ||= new Map()).set(dest, data);
                    }
                    else {
                        continue;
                    }
                    this.formatMessage(this.logType.WATCH, 'WATCH', ['Start', `${interval}ms ${expires ? formatDate(expires) : 'never'}`], uri, { titleColor: 'blue' });
                }
            }
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Watch;
    module.exports.default = Watch;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Watch;