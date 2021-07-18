/* eslint no-console: "off" */

import type { IModule } from '../types/lib';
import type { LogMessageOptions, LogTimeProcessOptions, LogValue, LoggerFormat } from '../types/lib/logger';
import type { AllSettledOptions, LoggerModule } from '../types/lib/module';
import type { Settings } from '../types/lib/node';

import { ERR_MESSAGE } from '../types/lib/logger';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');
import chalk = require('chalk');

type FormatMessageArgs = [number, string, LogValue, unknown, LogMessageOptions?];

const enum LOG_WIDTH { // eslint-disable-line no-shadow
    TITLE = 6,
    VALUE = 71,
    HINT = 32
}

export enum LOG_TYPE { // eslint-disable-line no-shadow
    UNKNOWN = 0,
    SYSTEM = 1,
    NODE = 2,
    PROCESS = 4,
    COMPRESS = 8,
    WATCH = 16,
    FILE = 32,
    CLOUD = 64,
    TIME_ELAPSED = 128,
    TIME_PROCESS = 256,
    FAIL = 512,
    HTTP = 1024
}

const SETTINGS: LoggerModule = {
    format: {
        title: {
            width: LOG_WIDTH.TITLE,
            justify: 'right'
        },
        value: {
            width: LOG_WIDTH.VALUE,
            justify: 'left'
        },
        hint: {
            width: LOG_WIDTH.HINT
        },
        message: {}
    }
};

const PROCESS_VERSION = process.version.substring(1).split('.').map(value => +value) as [number, number, number];
const ASYNC_FUNCTION = Object.getPrototypeOf(async () => {}).constructor;

function allSettled<T>(values: readonly (T | PromiseLike<T>)[]) {
    return Promise.all(values.map((promise: Promise<T>) => promise.then(value => ({ status: 'fulfilled', value })).catch(reason => ({ status: 'rejected', reason })) as Promise<PromiseSettledResult<T>>));
}

function applyFailStyle(options: LogMessageOptions) {
    for (const attr in Module.LOG_STYLE_FAIL) {
        if (!(attr in options)) {
            options[attr] = Module.LOG_STYLE_FAIL[attr];
        }
    }
    return options;
}

function applyFormatPadding(value: string, width: number, justify?: string, paddingRight = 0) {
    const offset = width - value.length;
    if (offset > 0) {
        switch (justify) {
            case 'right':
                value = value.padStart(width);
                if (paddingRight === 0) {
                    return value;
                }
                break;
            case 'center':
                value = value.padStart(value.length + Math.ceil((offset + paddingRight) / 2));
                break;
        }
        return value.padEnd(width + paddingRight);
    }
    else if (paddingRight > 0 && offset === 0) {
        return value + (paddingRight === 1 ? ' ' : ' '.repeat(paddingRight));
    }
    return value;
}

function getFormatWidth(format: Undef<LoggerFormat>, fallback: number) {
    if (format) {
        const value = format.width;
        if (typeof value === 'number' && value > 0) {
            return value;
        }
    }
    return fallback;
}

function getFormatJustify(format: Undef<LoggerFormat>, fallback?: Undef<string>) {
    if (format) {
        switch (format.justify) {
            case 'left':
            case 'center':
            case 'right':
                return format.justify;
        }
    }
    return fallback || 'left';
}

function isFailed(options?: LogMessageOptions) {
    if (options) {
        if (options.failed) {
            if (!options.titleColor && !options.titleBgColor) {
                options.titleColor = 'white';
                options.titleBgColor = 'bgGray';
            }
            return true;
        }
    }
    return false;
}

abstract class Module implements IModule {
    static LOG_TYPE = LOG_TYPE;
    static LOG_STYLE_FAIL: LogMessageOptions = { titleColor: 'white', titleBgColor: 'bgRed' };

    static supported(major: number, minor = 0, patch = 0, lts?: boolean) {
        if (PROCESS_VERSION[0] < major) {
            return false;
        }
        else if (PROCESS_VERSION[0] === major) {
            if (PROCESS_VERSION[1] < minor) {
                return false;
            }
            else if (PROCESS_VERSION[1] === minor) {
                return PROCESS_VERSION[2] >= patch;
            }
            return true;
        }
        return lts ? false : true;
    }

    static isObject<T = PlainObject>(value: unknown): value is T {
        return typeof value === 'object' && value !== null;
    }

    static isString(value: unknown): value is string {
        return typeof value === 'string' && value.length > 0;
    }

    static generateUUID(format = '8-4-4-4-12', dictionary?: string) {
        const match = format.match(/(\d+|[^\d]+)/g);
        if (match) {
            dictionary ||= '0123456789abcdef';
            return match.reduce((a, b) => {
                const length = +b;
                if (!isNaN(length)) {
                    for (let i = 0, j = dictionary!.length; i < length; ++i) {
                        a += dictionary![Math.floor(Math.random() * j)];
                    }
                    return a;
                }
                return a + b;
            }, '');
        }
        return uuid.v4();
    }

    static escapePattern(value: unknown) {
        return this.isString(value) ? value.replace(/[-|\\{}()[\]^$+*?.]/g, capture => capture === '-' ? '\\x2d' : '\\' + capture) : '';
    }

    static hasLogType(value: LOG_TYPE) {
        if (value === 0) {
            if (SETTINGS.unknown === false) {
                return false;
            }
        }
        else if (
            (value & LOG_TYPE.SYSTEM) && SETTINGS.system === false ||
            (value & LOG_TYPE.NODE) && SETTINGS.node === false ||
            (value & LOG_TYPE.PROCESS) && SETTINGS.process === false ||
            (value & LOG_TYPE.COMPRESS) && SETTINGS.compress === false ||
            (value & LOG_TYPE.WATCH) && SETTINGS.watch === false ||
            (value & LOG_TYPE.FILE) && SETTINGS.file === false ||
            (value & LOG_TYPE.CLOUD) && SETTINGS.cloud === false ||
            (value & LOG_TYPE.TIME_ELAPSED) && SETTINGS.time_elapsed === false ||
            (value & LOG_TYPE.TIME_PROCESS) && SETTINGS.time_process === false ||
            (value & LOG_TYPE.HTTP) && SETTINGS.http === false)
        {
            return false;
        }
        return true;
    }

    static formatMessage(type: LOG_TYPE, title: string, value: LogValue, message?: unknown, options: LogMessageOptions = {}) {
        if (options.type) {
            type |= options.type;
        }
        if (!this.hasLogType(type)) {
            return;
        }
        const format = SETTINGS.format!;
        const truncateString = (segment: string, length: number) => segment.length > length ? '...' + segment.substring(segment.length - length + 3) : segment;
        const useColor = () => !(options && options.useColor === false || SETTINGS.color === false);
        let valueWidth = getFormatWidth(format.value, LOG_WIDTH.VALUE),
            titleJustify = (type & LOG_TYPE.FAIL) === LOG_TYPE.FAIL || options.failed ? 'center' : getFormatJustify(format.title, 'right');
        if (type & LOG_TYPE.SYSTEM) {
            if (options.titleBgColor) {
                titleJustify = 'center';
            }
        }
        if (type & LOG_TYPE.NODE) {
            options.titleColor ||= 'black';
            options.titleBgColor ||= 'bgWhite';
            options.hintColor ||= 'yellow';
            titleJustify = 'center';
        }
        if (type & LOG_TYPE.PROCESS) {
            options.titleColor ||= 'magenta';
        }
        if (type & LOG_TYPE.WATCH) {
            titleJustify = 'center';
        }
        if (type & LOG_TYPE.TIME_ELAPSED) {
            if (options.titleBgColor) {
                titleJustify = 'center';
            }
            options.hintColor ||= 'yellow';
        }
        if (type & LOG_TYPE.TIME_PROCESS) {
            options.messageBgColor ||= options.failed ? 'bgGray' : 'bgCyan';
        }
        if (type & LOG_TYPE.HTTP) {
            options.titleColor ||= 'white';
            options.titleBgColor ||= options.failed ? 'bgGray' : 'bgGreen';
        }
        if (Array.isArray(value)) {
            const hint = value[1];
            if (this.isString(hint)) {
                const hintWidth = getFormatWidth(format.hint, LOG_WIDTH.HINT);
                const formatHint = (content: string) => {
                    let { hintColor, hintBgColor } = options;
                    if (!hintColor && !hintBgColor) {
                        ({ color: hintColor, bgColor: hintBgColor } = format.hint!);
                    }
                    try {
                        let output = content;
                        if (hintColor) {
                            output = chalk[hintColor](output);
                        }
                        if (hintBgColor) {
                            output = chalk[hintBgColor](output);
                        }
                        return output;
                    }
                    catch {
                    }
                    return content;
                };
                valueWidth -= Math.min(hint.length, hintWidth) + 2;
                value = applyFormatPadding(truncateString(value[0], valueWidth - 1), valueWidth, getFormatJustify(format.value)) + (useColor() ? chalk.blackBright('[') + formatHint(truncateString(hint, hintWidth)) + chalk.blackBright(']') : `[${truncateString(hint, hintWidth)}]`);
            }
            else {
                value = applyFormatPadding(truncateString(value[0], valueWidth - 1), valueWidth, getFormatJustify(format.value));
            }
        }
        else {
            value = applyFormatPadding(truncateString(value, valueWidth - 1), valueWidth, getFormatJustify(format.value));
        }
        title = applyFormatPadding(title.toUpperCase(), getFormatWidth(format.title, LOG_WIDTH.TITLE + 1), titleJustify, 1);
        let output: Undef<string>,
            error: Undef<boolean>;
        if (message instanceof Error) {
            message = SETTINGS.stack_trace && message.stack || message.message;
            error = true;
        }
        if (useColor()) {
            let { titleColor, titleBgColor, valueColor, valueBgColor, messageColor, messageBgColor } = options;
            if (!titleColor && !titleBgColor) {
                ({ color: titleColor, bgColor: titleBgColor } = format.title!);
            }
            if (!valueColor && !valueBgColor) {
                ({ color: valueColor, bgColor: valueBgColor } = format.value!);
            }
            if (!messageColor && !messageBgColor) {
                ({ color: messageColor, bgColor: messageBgColor } = format.message!);
            }
            try {
                let v = value,
                    m = message;
                if (m && SETTINGS.message !== false) {
                    if (messageColor) {
                        m = chalk[messageColor](m);
                    }
                    if (messageBgColor) {
                        m = chalk[messageBgColor](m);
                    }
                    m = ' ' + (error ? chalk.redBright('{') + chalk.bgWhite.blackBright(m) + chalk.redBright('}') : chalk.blackBright('(') + m + chalk.blackBright(')'));
                }
                else {
                    v = v.trim();
                    m = '';
                }
                if (valueColor) {
                    v = chalk[valueColor](v);
                }
                if (valueBgColor) {
                    v = chalk[valueBgColor](v);
                }
                output = chalk[titleBgColor || 'bgBlack'].bold[titleColor || 'green'](title) + chalk.blackBright(':') + ' ' + v + m;
            }
            catch (err) {
                this.writeFail('Invalid logger color scheme', err);
            }
        }
        output ||= title + ': ' + value + (message && SETTINGS.message !== false ? ' ' + (error ? '{' : '(') + message + (error ? '}' : ')') : '');
        console[(type & LOG_TYPE.FAIL) && (type & LOG_TYPE.FILE) ? 'error' : 'log'](output);
    }

    static writeFail(value: LogValue, message?: unknown, type?: LOG_TYPE) {
        this.formatMessage(type || LOG_TYPE.SYSTEM, 'FAIL!', value, message, { ...Module.LOG_STYLE_FAIL });
    }

    static asFunction<T = string>(value: string, sync = true): Undef<FunctionType<Promise<T> | T>> {
        const match = /^(async\s+)?(function\b([^(]*)\(([^)]*)\)\s*\{([\S\s]+)\})$/.exec(value = value.trim());
        if (match) {
            if (!sync || match[1]) {
                const args = match[4].trim().split(',').map(arg => arg.trim());
                args.push(match[5]);
                return new ASYNC_FUNCTION(...args);
            }
            value = match[2];
        }
        if (value.startsWith('function')) {
            const result = (0, eval)(`(${value})`);
            if (typeof result === 'function') {
                return result;
            }
        }
    }

    static parseFunction<T = string>(value: string, name?: string, sync = true): Undef<FunctionType<Promise<T> | T>> {
        const uri = Module.fromLocalPath(value = value.trim());
        if (uri) {
            try {
                value = fs.readFileSync(uri, 'utf8').trim();
            }
            catch (err) {
                this.writeFail([ERR_MESSAGE.READ_FILE, uri], err, LOG_TYPE.FILE);
                return;
            }
        }
        const result = this.asFunction<T>(value, sync);
        if (result) {
            return result;
        }
        if (name) {
            try {
                const handler = require(value);
                if (typeof handler === 'function' && handler.name === name) {
                    return handler as FunctionType<T>;
                }
            }
            catch {
            }
        }
    }

    static toPosix(value: unknown, filename = '') {
        return this.isString(value) ? value.trim().replace(/(?:^\\|\\+)/g, '/').replace(/\/+$/, '') + (filename ? '/' + filename : '') : filename;
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

    static hasSameStat(src: string, dest: string, keepEmpty?: boolean) {
        try {
            if (fs.existsSync(dest)) {
                const statSrc = fs.statSync(src);
                if (statSrc.size > 0) {
                    const statDest = fs.statSync(dest);
                    return statSrc.size === statDest.size && statSrc.mtimeMs === statDest.mtimeMs;
                }
                else if (!keepEmpty) {
                    fs.unlinkSync(src);
                }
            }
        }
        catch {
        }
        return false;
    }

    static hasSize(src: string) {
        try {
            const statSrc = fs.statSync(src);
            if (statSrc.size > 0) {
                return true;
            }
            fs.unlinkSync(src);
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

    static isPathUNC(value: string) {
        return /^(?:\\\\|\/\/)([\w.-]+)[\\/]([\w-]+\$|[\w-]+\$[\\/].+|[\w-]+[\\/].*)$/.test(value);
    }

    static isUUID(value: string) {
        return /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(value);
    }

    static isErrorCode(err: Error, ...code: string[]) {
        if (err instanceof Error) {
            const value = (err as SystemError).code;
            return typeof value === 'string' && code.includes(value);
        }
        return false;
    }

    static resolveUri(value: string) {
        if ((value = value.trim()).startsWith('file://')) {
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
                value = this.toPosix(value);
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

    static joinPath(...values: unknown[]) {
        values = values.filter(value => this.toPosix(value));
        let result = values[0] as string;
        for (let i = 1; i < values.length; ++i) {
            const trailing = values[i] as string;
            result += (trailing[0] !== '/' && !result.endsWith('/') ? '/' : '') + trailing;
        }
        return result || '';
    }

    static getFileSize(value: fs.PathLike) {
        try {
            return fs.statSync(value).size;
        }
        catch {
        }
        return 0;
    }

    static mkdirSafe(value: string, skipCheck?: boolean) {
        if (!skipCheck) {
            try {
                return fs.lstatSync(value).isDirectory();
            }
            catch {
            }
        }
        let index = value.lastIndexOf(path.sep);
        if (index === -1) {
            index = value.lastIndexOf(path.sep === '/' ? '\\' : '/');
        }
        if (index !== -1) {
            try {
                if (fs.existsSync(value.substring(0, index))) {
                    fs.mkdirSync(value);
                    return true;
                }
            }
            catch {
            }
        }
        try {
            fs.mkdirpSync(value);
            return true;
        }
        catch (err) {
            this.writeFail([ERR_MESSAGE.CREATE_DIRECTORY, value], err, LOG_TYPE.FILE);
        }
        return false;
    }

    static allSettled<T>(values: readonly (T | PromiseLike<T>)[], options?: AllSettledOptions) {
        const promise = Promise.allSettled ? Promise.allSettled(values) as Promise<PromiseSettledResult<T>[]> : allSettled(values);
        if (options) {
            const { rejected, errors, type } = options;
            if (rejected || errors) {
                promise.then(result => {
                    const items: PromiseSettledResult<T>[] = [];
                    for (const item of result) {
                        if (item.status === 'rejected') {
                            const reason = item.reason;
                            if (reason) {
                                if (rejected) {
                                    this.writeFail(rejected, reason instanceof Error ? reason : new Error(reason), type);
                                }
                                if (errors) {
                                    errors.push(reason.toString());
                                }
                            }
                        }
                        else {
                            items.push(item);
                        }
                    }
                    return items;
                });
            }
        }
        return promise;
    }

    static loadSettings(value: Settings) {
        const logger = value.logger;
        if (this.isObject<LoggerModule>(logger)) {
            for (const attr in logger) {
                if (attr === 'format') {
                    const current = SETTINGS.format!;
                    const format = logger.format;
                    if (this.isObject(format)) {
                        for (const section in format) {
                            const item = format[section] as LoggerModule;
                            if (this.isObject(item)) {
                                Object.assign(current[section], item);
                            }
                        }
                    }
                }
                else {
                    SETTINGS[attr] = logger[attr];
                }
            }
            const stack_trace = logger.stack_trace;
            if (typeof stack_trace === 'number' && stack_trace > 0) {
                Error.stackTraceLimit = stack_trace;
            }
        }
    }

    moduleName = 'unknown';
    tempDir = 'tmp';
    readonly major = PROCESS_VERSION[0];
    readonly minor = PROCESS_VERSION[1];
    readonly patch = PROCESS_VERSION[2];
    readonly errors: string[] = [];

    private _logQueued: FormatMessageArgs[] = [];

    supported(major: number, minor?: number, patch?: number, lts?: boolean) {
        return Module.supported(major, minor, patch, lts);
    }
    getTempDir(uuidDir?: boolean, filename = '') {
        return process.cwd() + path.sep + this.tempDir + path.sep + (uuidDir ? uuid.v4() + path.sep : '') + (filename[0] === '.' ? uuid.v4() : '') + filename;
    }
    writeFail(value: LogValue, message?: unknown, type: LOG_TYPE = LOG_TYPE.SYSTEM) {
        type |= LOG_TYPE.FAIL;
        this.formatFail(type, 'FAIL!', value, message);
    }
    writeTimeProcess(title: string, value: string, time: number, options?: LogTimeProcessOptions) {
        time = Date.now() - time;
        const failed = isFailed(options);
        const meter = (failed ? 'X' : '>').repeat(Math.ceil(time / (options && options.meterIncrement || 250)));
        const args: FormatMessageArgs = [LOG_TYPE.TIME_PROCESS, title, [(options && (options.type || 0) & LOG_TYPE.HTTP ? '' : (failed ? 'Failed' : 'Completed') + ' -> ') + value, time / 1000 + 's'], meter, options];
        if (options && options.queue) {
            this._logQueued.push(args);
        }
        else {
            Module.formatMessage(...args);
        }
    }
    writeTimeElapsed(title: string, value: string, time: number, options?: LogMessageOptions) {
        const args: FormatMessageArgs = [LOG_TYPE.TIME_ELAPSED, title, [isFailed(options) ? 'Failed' : 'Completed', (Date.now() - time) / 1000 + 's'], value, options];
        if (options && options.queue) {
            this._logQueued.push(args);
        }
        else {
            Module.formatMessage(...args);
        }
    }
    formatFail(type: LOG_TYPE, title: string, value: LogValue, message?: unknown, options: LogMessageOptions = {}) {
        type |= LOG_TYPE.FAIL;
        const args: FormatMessageArgs = [type, title, value, message, applyFailStyle(options)];
        if (options && options.queue !== false) {
            this._logQueued.push(args);
        }
        else {
            Module.formatMessage(...args);
        }
        if (message) {
            this.errors.push(message instanceof Error ? SETTINGS.stack_trace && message.stack || message.message : (message as string).toString());
        }
    }
    formatMessage(type: LOG_TYPE, title: string, value: LogValue, message?: unknown, options?: LogMessageOptions) {
        const args: FormatMessageArgs = [type, title, value, message, options];
        if (options && options.queue) {
            this._logQueued.push(args);
        }
        else {
            Module.formatMessage(...args);
        }
    }
    flushLog() {
        const logQueued = this._logQueued;
        if (logQueued.length) {
            logQueued.sort((a, b) => b[0] - a[0]);
            for (const args of logQueued) {
                Module.formatMessage(...args);
            }
            logQueued.length = 0;
        }
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