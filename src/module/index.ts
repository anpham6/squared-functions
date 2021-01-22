import type { ResponseData } from '../types/lib/squared';

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
    CLOUD_STORAGE = 32,
    CLOUD_DATABASE = 64,
    TIME_ELAPSED = 128
}

let SETTINGS: LoggerModule = {};

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
    public static LOG_TYPE = LOG_TYPE;
    public static LOG_STYLE_FAIL: LogMessageOptions = { titleColor: 'white', titleBgColor: 'bgRed' };

    public static formatMessage(type: LOG_TYPE, title: string, value: LogValue, message?: unknown, options: LogMessageOptions = {}) {
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
            case LOG_TYPE.CLOUD_STORAGE:
                if (SETTINGS.cloud_storage === false) {
                    return;
                }
                break;
            case LOG_TYPE.CLOUD_DATABASE:
                if (SETTINGS.cloud_database === false) {
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
        if (Array.isArray(value)) {
            let length = 0;
            if (value[1] && (length = value[1].length)) {
                const formatHint = (hint: string) => {
                    const { hintColor, hintBgColor } = options;
                    if (hintColor) {
                        hint = chalk[hintColor](hint);
                    }
                    if (hintBgColor) {
                        hint = chalk[hintBgColor](hint);
                    }
                    return hint;
                };
                value = value[0].padEnd(38) + (length < 32 ? chalk.blackBright(' '.repeat(32 - length)) : '') + chalk.blackBright('[') + formatHint(length > 32 ? value[1].substring(0, 29) + '...' : value[1]) + chalk.blackBright(']');
            }
            else {
                value = value[0].padEnd(72);
            }
        }
        else {
            value = value.padEnd(72);
        }
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

    public static writeFail(value: LogValue, message?: Null<Error>) {
        this.formatMessage(LOG_TYPE.SYSTEM, 'FAIL', value, message, applyFailStyle());
    }

    public static parseFunction(value: string, name?: string): Undef<FunctionType<string>> {
        const uri = Module.fromLocalPath(value = value.trim());
        if (uri) {
            try {
                value = fs.readFileSync(uri, 'utf8').trim();
            }
            catch (err) {
                this.writeFail(['Could not load function', value], err);
                return;
            }
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

    public static toPosix(value: string, filename?: string) {
        return value ? value.replace(/\\+/g, '/').replace(/\/+$/, '') + (filename ? '/' + filename : '') : '';
    }

    public static renameExt(value: string, ext: string) {
        const index = value.lastIndexOf('.');
        return (index !== -1 ? value.substring(0, index) : value) + (ext[0] === ':' ? ext + path.extname(value) : '.' + ext);
    }

    public static fromLocalPath(value: string) {
        return /^\.?\.?[\\/]/.test(value = value.trim()) ? value[0] !== '.' ? path.join(process.cwd(), value) : path.resolve(value) : '';
    }

    public static hasSameOrigin(value: string, other: string) {
        try {
            return new URL(value).origin === new URL(other).origin;
        }
        catch {
        }
        return false;
    }

    public static isFileHTTP(value: string) {
        return /^https?:\/\/[^/]/i.test(value);
    }

    public static isFileUNC(value: string) {
        return /^\\\\([\w.-]+)\\([\w-]+\$?)((?<=\$)(?:[^\\]*|\\.+)|\\.+)$/.test(value);
    }

    public static isDirectoryUNC(value: string) {
        return /^\\\\([\w.-]+)\\([\w-]+\$|[\w-]+\$\\.+|[\w-]+\\.*)$/.test(value);
    }

    public static isUUID(value: string) {
        return /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(value);
    }

    public static resolveUri(value: string) {
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

    public static resolvePath(value: string, href: string) {
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
                return Module.joinPosix(origin, pathname.join('/'), value);
            }
            catch {
            }
        }
        return '';
   }

   public static joinPosix(...values: Undef<string>[]) {
        values = values.filter(value => value && value.trim());
        let result = '';
        for (let i = 0; i < values.length; ++i) {
            const trailing = values[i]!.replace(/\\+/g, '/');
            if (i === 0) {
                result = trailing;
            }
            else {
                const leading = values[i - 1];
                result += (leading && trailing && !leading.endsWith('/') && !trailing.startsWith('/') ? '/' : '') + trailing;
            }
        }
        return result;
    }

    public static getFileSize(value: fs.PathLike) {
        try {
            return fs.statSync(value).size;
        }
        catch {
        }
        return 0;
    }

    public static responseError(err: Error | string, hint?: string) {
        return {
            success: false,
            error: {
                hint,
                message: err instanceof Error ? err.message : err.toString()
            }
        } as ResponseData;
    }

    public static allSettled<T>(values: readonly (T | PromiseLike<T>)[], rejected?: string | [string, string], errors?: string[]) {
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

    public static loadSettings(value: Settings) {
        if (value.logger) {
            SETTINGS = value.logger;
        }
    }

    public major: number;
    public minor: number;
    public patch: number;
    public tempDir = 'tmp';
    public moduleName?: string;
    public readonly errors: string[] = [];

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
    writeFail(value: LogValue, message?: Null<Error>) {
        this.formatFail(LOG_TYPE.SYSTEM, ' FAIL! ', value, message);
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