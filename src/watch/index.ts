import type { ExternalAsset, IWatch } from '../types/lib';

import Module from '../module';

import request = require('request');

interface FileWatch {
    uri: string;
    etag: string;
    assets: ExternalAsset[];
    expires: number;
    interval: number;
}

const HTTP_MAP: ObjectMap<Map<string, FileWatch>> = {};
const TIMER_MAP: ObjectMap<[NodeJS.Timeout, number]> = {};

const getInterval = (file: ExternalAsset) => Math.max(typeof file.watch === 'object' && file.watch.interval || 0, 0);
const formatDate = (value: number) => new Date(value).toLocaleString().replace(/\/20\d+, /, '@').replace(/:\d+ (AM|PM)$/, (...match) => match[1]);

class Watch extends Module implements IWatch {
    public whenModified?: (assets: ExternalAsset[]) => void;

    constructor(public interval = 200) {
        super();
    }

    start(assets: ExternalAsset[]) {
        const etagMap: StringMap = {};
        const destMap: ObjectMap<ExternalAsset[]> = {};
        for (const item of assets.slice(0).sort((a, b) => a.etag ? -1 : b.etag ? 1 : 0)) {
            const { uri, relativeUri: dest } = item;
            if (uri && dest) {
                if (item.etag) {
                    etagMap[uri] = item.etag;
                    (destMap[dest] ||= []).push(item);
                }
                else if (destMap[dest]) {
                    item.etag = etagMap[uri];
                    destMap[dest].push(item);
                }
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
                    const http = HTTP_MAP[uri];
                    const timer = TIMER_MAP[uri];
                    const data = {
                        uri,
                        etag,
                        assets: items,
                        interval,
                        expires
                    } as FileWatch;
                    if (http && http.size && interval <= timer[1]) {
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
                                            if (value) {
                                                if (value !== input.etag) {
                                                    input.etag = value;
                                                    if (this.whenModified) {
                                                        this.whenModified(input.assets);
                                                    }
                                                    this.formatMessage(this.logType.WATCH, 'WATCH', 'File modified', uri, { titleColor: 'yellow' });
                                                }
                                                else {
                                                    return;
                                                }
                                            }
                                        }
                                        else if (input.expires) {
                                            map.delete(output);
                                            if (map.size === 0) {
                                                this.formatMessage(this.logType.WATCH, 'WATCH', ['Expired', 'since ' + formatDate(start)], uri, { titleColor: 'grey' });
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