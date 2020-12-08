import path = require('path');
import fs = require('fs');
import chalk = require('chalk');

type Settings = functions.Settings;
type LoggerModule = functions.ExtendedSettings.LoggerModule;
type LogMessageOptions = functions.internal.LogMessageOptions;
type LogValue = string | [string, string];

let SETTINGS: LoggerModule = {};

export enum LOG_TYPE {
    UNKNOWN = 0,
    SYSTEM = 1,
    CHROME = 2,
    COMPRESS = 4,
    IMAGE = 8,
    NODE = 16,
    WATCH = 32,
    CLOUD_STORAGE = 64,
    CLOUD_DATABASE = 128,
    TIME_ELAPSED = 256
}

const Module = class implements functions.IModule {
    public static loadSettings(value: Settings) {
        if (value.logger) {
            SETTINGS = value.logger;
        }
    }

    public static getFileSize(fileUri: string) {
        try {
            return fs.statSync(fileUri).size;
        }
        catch {
        }
        return 0;
    }

    public static toPosix(value: string, filename?: string) {
        return value.replace(/\\+/g, '/').replace(/\/+$/, '') + (filename ? '/' + filename : '');
    }

    public static renameExt(value: string, ext: string) {
        const index = value.lastIndexOf('.');
        return (index !== -1 ?value.substring(0, index) : value) + '.' + ext;
    }

    public major: number;
    public minor: number;
    public patch: number;

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
    getTempDir() {
        return process.cwd() + path.sep + 'temp' + path.sep;
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
        options.hintColor ||= 'magenta';
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
        switch (type) {
            case LOG_TYPE.SYSTEM:
                if (SETTINGS.system === false) {
                    return;
                }
                break;
            case LOG_TYPE.CHROME:
                if (SETTINGS.chrome === false) {
                    return;
                }
                break;
            case LOG_TYPE.COMPRESS:
                if (SETTINGS.compress === false) {
                    return;
                }
                break;
            case LOG_TYPE.IMAGE:
                if (SETTINGS.image === false) {
                    return;
                }
                break;
            case LOG_TYPE.NODE:
                if (SETTINGS.node === false) {
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
        this.writeMessage(title.padEnd(6), value, message, options);
    }
    writeMessage(title: string, value: string, message: unknown = '', options: LogMessageOptions = {}) {
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
        console.log(chalk[titleBgColor].bold[titleColor](title.toUpperCase()) + chalk.blackBright(':') + ' ' + value + message);
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