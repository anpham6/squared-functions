import type { IModule } from '../types/lib';
import type { LogMessageOptions, LogValue } from '../types/lib/logger';
import type { LoggerModule } from '../types/lib/module';
import type { Settings } from '../types/lib/node';

import path = require('path');
import fs = require('fs');
import uuid = require('uuid');
import chalk = require('chalk');

export enum LOG_TYPE { // eslint-disable-line no-shadow
    UNKNOWN = 0,
    SYSTEM = 1,
    NODE = 2,
    PROCESS = 4,
    COMPRESS = 8,
    WATCH = 16,
    FILE = 32,
    CLOUD = 64,
    TIME_ELAPSED = 128
}

const ASYNC_FUNCTION = Object.getPrototypeOf(async () => {}).constructor as Constructor<FunctionType<Promise<string>, string>>;
const SETTINGS: LoggerModule = {};

function allSettled<T>(values: readonly (T | PromiseLike<T>)[]) {
    return Promise.all(values.map((promise: Promise<T>) => promise.then(value => ({ status: 'fulfilled', value })).catch(reason => ({ status: 'rejected', reason })) as Promise<PromiseSettledResult<T>>));
}

function applyFailStyle(options: LogMessageOptions = {}) {
    for (const attr in Module.LOG_STYLE_FAIL) {
        if (!(attr in options)) {
            options[attr] ||= Module.LOG_STYLE_FAIL[attr];
        }
    }
    return options;
}

abstract class Module implements IModule {
    static LOG_TYPE = LOG_TYPE;
    static LOG_STYLE_FAIL: LogMessageOptions = { titleColor: 'white', titleBgColor: 'bgRed' };

    static isObject<T = PlainObject>(value: unknown): value is T {
        return typeof value === 'object' && value !== null;
    }

    static escapePattern(value: string) {
        return typeof value === 'string' ? value.replace(/[-|\\{}()[\]^$+*?.]/g, capture => capture === '-' ? '\\x2d' : '\\' + capture) : '';
    }

    static formatMessage(type: LOG_TYPE, title: string, value: LogValue, message?: unknown, options: LogMessageOptions = {}) {
        switch (type) {
            case LOG_TYPE.SYSTEM:
                if (SETTINGS.system === false) {
                    return;
                }
                break;
            case LOG_TYPE.PROCESS:
                if (SETTINGS.process === false) {
                    return;
                }
                options.titleColor ||= 'magenta';
                break;
            case LOG_TYPE.NODE:
                if (SETTINGS.node === false) {
                    return;
                }
                options.titleColor ||= 'black';
                options.titleBgColor ||= 'bgWhite';
                options.hintColor ||= 'yellow';
                break;
            case LOG_TYPE.COMPRESS:
                if (SETTINGS.compress === false) {
                    return;
                }
                break;
            case LOG_TYPE.WATCH:
                if (SETTINGS.watch === false) {
                    return;
                }
                break;
            case LOG_TYPE.FILE:
                if (SETTINGS.file === false) {
                    return;
                }
                break;
            case LOG_TYPE.CLOUD:
                if (SETTINGS.cloud === false) {
                    return;
                }
                break;
            case LOG_TYPE.TIME_ELAPSED:
                if (SETTINGS.time_elapsed === false) {
                    return;
                }
                options.hintColor ||= 'magenta';
                break;
            default:
                if (SETTINGS.unknown === false) {
                    return;
                }
                break;
        }
        const useColor = !(options.useColor === false || SETTINGS.color === false);
        if (Array.isArray(value)) {
            const hint = value[1] as string;
            let length = 0;
            if (typeof hint === 'string' && (length = hint.length)) {
                const getHint = () => length > 32 ? hint.substring(0, 29) + '...' : hint;
                const formatHint = (content: string) => {
                    const { hintColor, hintBgColor } = options;
                    if (hintColor) {
                        content = chalk[hintColor](content);
                    }
                    if (hintBgColor) {
                        content = chalk[hintBgColor](content);
                    }
                    return content;
                };
                value = value[0].padEnd(38);
                if (length < 32) {
                    let padding = ' '.repeat(32 - length);
                    if (useColor) {
                        padding = chalk.blackBright(padding);
                    }
                    value += padding;
                }
                value += useColor ? chalk.blackBright('[') + formatHint(getHint()) + chalk.blackBright(']') : `[${getHint()}]`;
            }
            else {
                value = value[0].padEnd(72);
            }
        }
        else {
            value = value.padEnd(72);
        }
        if (useColor) {
            const { titleColor = 'green', titleBgColor = 'bgBlack', valueColor, valueBgColor, messageColor, messageBgColor } = options;
            if (valueColor) {
                value = chalk[valueColor](value);
            }
            if (valueBgColor) {
                value = chalk[valueBgColor](value);
            }
            if (message) {
                if (messageColor) {
                    message = chalk[messageColor](message);
                }
                if (messageBgColor) {
                    message = chalk[messageBgColor](message);
                }
                message = ' ' + chalk.blackBright('(') + message + chalk.blackBright(')');
            }
            console.log(chalk[titleBgColor].bold[titleColor](title.toUpperCase().padEnd(7)) + chalk.blackBright(':') + ' ' + value + (message || '')); // eslint-disable-line no-console
        }
        else {
            console.log(title.toUpperCase().padEnd(7) + ':' + ' ' + value + (message && ` (${message as string})` || '')); // eslint-disable-line no-console
        }
    }

    static writeFail(value: LogValue, message?: Null<Error>, type?: LOG_TYPE) {
        this.formatMessage(type || LOG_TYPE.SYSTEM, ' FAIL! ', value, message, applyFailStyle());
    }

    static parseFunction(value: string, name?: string, sync = true): Undef<FunctionType<Promise<string> | string>> {
        const uri = Module.fromLocalPath(value = value.trim());
        if (uri) {
            try {
                value = fs.readFileSync(uri, 'utf8').trim();
            }
            catch (err) {
                this.writeFail(['Unable to read file', path.basename(uri)], err, LOG_TYPE.FILE);
                return;
            }
        }
        const match = /^(async\s+)?(function\s+([^(]*)\(([^)]*)\)\s*\{([\S\s]+)\})$/.exec(value);
        if (match) {
            if (!sync || match[1]) {
                const args = match[4].trim().split(',').map(arg => arg.trim());
                args.push(match[5]);
                return new ASYNC_FUNCTION(...args);
            }
            value = match[2];
        }
        if (value.startsWith('function')) {
            return (0, eval)(`(${value})`);
        }
        if (name) {
            try {
                const handler = require(value);
                if (typeof handler === 'function' && handler.name === name) {
                    return handler as FunctionType<string>;
                }
            }
            catch {
            }
        }
    }

    static toPosix(value: string, filename?: string) {
        return value ? value.replace(/\\+/g, '/').replace(/\/+$/, '') + (filename ? '/' + filename : '') : '';
    }

    static renameExt(value: string, ext: string) {
        const index = value.lastIndexOf('.');
        return (index !== -1 ? value.substring(0, index) : value) + (ext[0] === ':' ? ext + path.extname(value) : '.' + ext);
    }

    static fromLocalPath(value: string) {
        return /^\.?\.?[\\/]/.test(value = value.trim()) ? value[0] !== '.' ? path.join(process.cwd(), value) : path.resolve(value) : '';
    }

    static hasSameOrigin(value: string, other: string) {
        try {
            return new URL(value).origin === new URL(other).origin;
        }
        catch {
        }
        return false;
    }

    static isFileHTTP(value: string) {
        return /^https?:\/\/[^/]/i.test(value);
    }

    static isFileUNC(value: string) {
        return /^(?:\\\\|\/\/)([\w.-]+)[\\/]([\w-]+\$?)((?<=\$)(?:[^\\/]*|[\\/].+)|[\\/].+)$/.test(value);
    }

    static isDirectoryUNC(value: string) {
        return /^(?:\\\\|\/\/)([\w.-]+)[\\/]([\w-]+\$|[\w-]+\$[\\/].+|[\w-]+[\\/].*)$/.test(value);
    }

    static isUUID(value: string) {
        return /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(value);
    }

    static resolveUri(value: string) {
        if (value.startsWith('file://')) {
            try {
                let url = new URL(value).pathname;
                if (path.isAbsolute(url)) {
                    if (path.sep === '\\' && /^\/[A-Za-z]:\//.test(url)) {
                        url = url.substring(1);
                    }
                    return path.resolve(url);
                }
            }
            catch {
            }
            return '';
        }
        return value;
    }

    static resolvePath(value: string, href: string) {
        if ((value = value.trim()).startsWith('http')) {
            return value;
        }
        if (href.startsWith('http')) {
            try {
                const url = new URL(href);
                const origin = url.origin;
                const pathname = url.pathname.split('/');
                --pathname.length;
                value = value.replace(/\\/g, '/');
                if (value[0] === '/') {
                    return origin + value;
                }
                else if (value.startsWith('../')) {
                    const trailing: string[] = [];
                    for (const dir of value.split('/')) {
                        if (dir === '..') {
                            if (trailing.length === 0) {
                                pathname.pop();
                            }
                            else {
                                --trailing.length;
                            }
                        }
                        else {
                            trailing.push(dir);
                        }
                    }
                    value = trailing.join('/');
                }
                return Module.joinPath(origin, pathname.join('/'), value);
            }
            catch {
            }
        }
        return '';
    }

    static joinPath(...values: Undef<string>[]) {
        values = values.filter(value => value && value.trim().replace(/\\/g, '/'));
        let result = '';
        for (let i = 0; i < values.length; ++i) {
            const trailing = values[i]!;
            if (i === 0) {
                result = trailing;
            }
            else {
                const leading = values[i - 1];
                result += (leading && trailing && !leading.endsWith('/') && trailing[0] !== '/' ? '/' : '') + trailing;
            }
        }
        return result;
    }

    static getFileSize(value: fs.PathLike) {
        try {
            return fs.statSync(value).size;
        }
        catch {
        }
        return 0;
    }

    static allSettled<T>(values: readonly (T | PromiseLike<T>)[], rejected?: string | [string, string], errors?: string[]) {
        const promise = Promise.allSettled ? Promise.allSettled(values) as Promise<PromiseSettledResult<T>[]> : allSettled(values);
        if (rejected) {
            promise.then(result => {
                for (const item of result) {
                    if (item.status === 'rejected' && item.reason) {
                        this.writeFail(rejected, item.reason);
                        if (errors) {
                            errors.push(item.reason.toString());
                        }
                    }
                }
            });
        }
        return promise;
    }

    static loadSettings(value: Settings) {
        if (value.logger) {
            Object.assign(SETTINGS, value.logger);
        }
    }

    major: number;
    minor: number;
    patch: number;
    tempDir = 'tmp';
    moduleName?: string;
    readonly errors: string[] = [];

    constructor() {
        [this.major, this.minor, this.patch] = process.version.substring(1).split('.').map(value => +value);
    }

    supported(major: number, minor: number, patch = 0) {
        if (this.major < major) {
            return false;
        }
        else if (this.major === major) {
            if (this.minor < minor) {
                return false;
            }
            else if (this.minor === minor) {
                return this.patch >= patch;
            }
            return true;
        }
        return true;
    }
    getTempDir(uuidDir?: boolean, filename = '') {
        return process.cwd() + path.sep + this.tempDir + path.sep + (uuidDir ? uuid.v4() + path.sep : '') + (filename[0] === '.' ? uuid.v4() : '') + filename;
    }
    writeFail(value: LogValue, message?: Null<Error>, type?: LOG_TYPE) {
        this.formatFail(type || LOG_TYPE.SYSTEM, ' FAIL! ', value, message);
    }
    writeTimeElapsed(title: string, value: string, time: number, options?: LogMessageOptions) {
        Module.formatMessage(LOG_TYPE.TIME_ELAPSED, title, ['Completed', (Date.now() - time) / 1000 + 's'], value, options);
    }
    formatFail(type: LOG_TYPE, title: string, value: LogValue, message?: Null<Error>, options?: LogMessageOptions) {
        Module.formatMessage(type, title, value, message, applyFailStyle(options));
        if (message) {
            this.errors.push(message instanceof Error ? message.message : (message as string).toString());
        }
    }
    formatMessage(type: LOG_TYPE, title: string, value: LogValue, message?: unknown, options?: LogMessageOptions) {
        Module.formatMessage(type, title, value, message, options);
    }
    get logType() {
        return LOG_TYPE;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Module;
    module.exports.default = Module;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Module;