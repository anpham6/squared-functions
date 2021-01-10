import type { ExtendedSettings, IModule, Internal, Settings } from '../types/lib';

import path = require('path');
import fs = require('fs');
import uuid = require('uuid');
import chalk = require('chalk');

type LoggerModule = ExtendedSettings.LoggerModule;

type LogMessageOptions = Internal.LogMessageOptions;

type LogValue = string | [string, string];

let SETTINGS: LoggerModule = {};

// eslint-disable-next-line no-shadow
export enum LOG_TYPE {
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

function allSettled<T>(values: readonly (T | PromiseLike<T>)[]) {
    return Promise.all(values.map((promise: Promise<T>) => promise.then(value => ({ status: 'fulfilled', value })).catch(reason => ({ status: 'rejected', reason })) as Promise<PromiseSettledResult<T>>));
}

function writeMessage(title: string, value: string, message?: unknown, options: LogMessageOptions = {}) {
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
    console.log(chalk[titleBgColor].bold[titleColor](title.toUpperCase()) + chalk.blackBright(':') + ' ' + value + (message || '')); // eslint-disable-line no-console
}

const Module = class implements IModule {
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
            const length = value[1] ? value[1].length : 0;
            if (length) {
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
        writeMessage(title.padEnd(6), value, message, options);
    }

    public static allSettled<T>(values: readonly (T | PromiseLike<T>)[], rejected?: string | [string, string]) {
        const promise = Promise.allSettled ? Promise.allSettled(values) as Promise<PromiseSettledResult<T>[]> : allSettled(values);
        if (rejected) {
            promise.then(result => {
                for (const item of result) {
                    if (item.status === 'rejected') {
                        this.formatMessage(LOG_TYPE.SYSTEM, 'FAIL', rejected, item.reason, { titleColor: 'white', titleBgColor: 'bgRed' });
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

    public static getFileSize(localUri: string) {
        try {
            return fs.statSync(localUri).size;
        }
        catch {
        }
        return 0;
    }

    public static toPosix(value: string, filename?: string) {
        return value ? value.replace(/\\+/g, '/').replace(/\/+$/, '') + (filename ? '/' + filename : '') : '';
    }

    public static renameExt(value: string, ext: string) {
        const index = value.lastIndexOf('.');
        return (index !== -1 ?value.substring(0, index) : value) + '.' + ext;
    }

    public static isLocalPath(value: string) {
        return /^\.?\.[\\/]/.test(value);
    }

    public static fromSameOrigin(value: string, other: string) {
        return new URL(value).origin === new URL(other).origin;
    }

    public major: number;
    public minor: number;
    public patch: number;
    public tempDir = 'tmp';

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
    parseFunction(value: string): Null<FunctionType<string>> {
        if (Module.isLocalPath(value = value.trim())) {
            try {
                value = fs.readFileSync(path.resolve(value), 'utf8').trim();
            }
            catch (err) {
                this.writeFail(['Could not load function', value], err);
                return null;
            }
        }
        return value.startsWith('function') ? eval(`(${value})`) as FunctionType<string> : null;
    }
    getTempDir(subDir?: boolean, filename = '') {
        return process.cwd() + path.sep + this.tempDir + path.sep + (subDir ? uuid.v4() + path.sep : '') + (filename.startsWith('.') ? uuid.v4() : '') + filename;
    }
    joinPosix(...paths: Undef<string>[]) {
        paths = paths.filter(value => value && value.trim());
        let result = '';
        for (let i = 0; i < paths.length; ++i) {
            const trailing = paths[i]!.replace(/\\+/g, '/');
            if (i === 0) {
                result = trailing;
            }
            else {
                const leading = paths[i - 1];
                result += (leading && trailing && !leading.endsWith('/') && !trailing.startsWith('/') ? '/' : '') + trailing;
            }
        }
        return result;
    }
    writeTimeElapsed(title: string, value: string, time: number, options: LogMessageOptions = {}) {
        this.formatMessage(LOG_TYPE.TIME_ELAPSED, title, ['Completed', (Date.now() - time) / 1000 + 's'], value, options);
    }
    writeFail(value: LogValue, message?: unknown) {
        this.formatFail(LOG_TYPE.SYSTEM, 'FAIL', value, message);
    }
    formatFail(type: LOG_TYPE, title: string, value: LogValue, message?: unknown, options: LogMessageOptions = {}) {
        options.titleColor ||= 'white';
        options.titleBgColor ||= 'bgRed';
        this.formatMessage(type, title, value, message, options);
    }
    formatMessage(type: LOG_TYPE, title: string, value: LogValue, message?: unknown, options: LogMessageOptions = {}) {
        Module.formatMessage(type, title, value, message, options);
    }
    writeMessage(title: string, value: string, message?: unknown, options: LogMessageOptions = {}) {
        writeMessage(title, value, message, options);
    }
    get logType() {
        return LOG_TYPE;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Module;
    module.exports.default = Module;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Module;