import type { BackgroundColor, ForegroundColor } from 'chalk';

import path = require('path');
import fs = require('fs');
import chalk = require('chalk');

type Settings = functions.Settings;
type LoggingModule = functions.settings.LoggingModule;

let SETTINGS: LoggingModule = {};

export enum LOGGING {
    UNKNOWN = 0,
    SYSTEM = 1,
    CHROME = 2,
    COMPRESS = 4,
    IMAGE = 8,
    NODE = 16,
    WATCH = 32,
    CLOUD_STORAGE = 64,
    CLOUD_DATABASE = 128
}

const getMessage = (value: unknown) => value ? ' ' + chalk.blackBright('(') + value + chalk.blackBright(')') : '';

const Module = class implements functions.IModule {
    public static loadSettings(value: Settings) {
        if (value.logging) {
            SETTINGS = value.logging;
        }
    }

    public major: number;
    public minor: number;
    public patch: number;

    constructor() {
        [this.major, this.minor, this.patch] = process.version.substring(1).split('.').map(value => +value);
    }

    checkVersion(major: number, minor: number, patch = 0) {
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
    getFileSize(fileUri: string) {
        try {
            return fs.statSync(fileUri).size;
        }
        catch {
        }
        return 0;
    }
    replaceExtension(value: string, ext: string) {
        const index = value.lastIndexOf('.');
        return (index !== -1 ?value.substring(0, index) : value) + '.' + ext;
    }
    getTempDir() {
        return process.cwd() + path.sep + 'temp' + path.sep;
    }
    escapePosix(value: string) {
        return value.replace(/[\\/]/g, '[\\\\/]');
    }
    toPosix(value: string, filename?: string) {
        return value.replace(/\\+/g, '/').replace(/\/+$/, '') + (filename ? '/' + filename : '');
    }
    writeFail(value: string | [string, string], message?: unknown) {
        this.formatMessage(LOGGING.SYSTEM, 'FAIL', value, message, 'white', 'bgRed');
    }
    formatMessage(type: LOGGING, title: string, value: string | [string, string], message?: unknown, color: typeof ForegroundColor = 'green', bgColor: typeof BackgroundColor = 'bgBlack') {
        switch (type) {
            case LOGGING.SYSTEM:
                if (SETTINGS.system === false) {
                    return;
                }
                break;
            case LOGGING.CHROME:
                if (SETTINGS.chrome === false) {
                    return;
                }
                break;
            case LOGGING.COMPRESS:
                if (SETTINGS.compress === false) {
                    return;
                }
                break;
            case LOGGING.IMAGE:
                if (SETTINGS.image === false) {
                    return;
                }
                break;
            case LOGGING.NODE:
                if (SETTINGS.node === false) {
                    return;
                }
                break;
            case LOGGING.WATCH:
                if (SETTINGS.watch === false) {
                    return;
                }
                break;
            case LOGGING.CLOUD_STORAGE:
                if (SETTINGS.cloud_storage === false) {
                    return;
                }
                break;
            case LOGGING.CLOUD_DATABASE:
                if (SETTINGS.cloud_database === false) {
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
            value = length ? value[0].padEnd(35) + (length < 30 ? chalk.blackBright(' '.repeat(30 - length)) : '') + chalk.blackBright('[') + (length > 30 ? value[1].substring(0, 27) + '...' : value[1]) + chalk.blackBright(']') : value[0].padEnd(67);
        }
        else {
            value = value.padEnd(67);
        }
        this.writeMessage(title.padEnd(6), value, message, color, bgColor);
    }
    writeMessage(title: string, value: string, message?: unknown, color: typeof ForegroundColor = 'green', bgColor: typeof BackgroundColor = 'bgBlack') {
        console.log(chalk[bgColor].bold[color](title.toUpperCase()) + chalk.blackBright(':') + ' ' + value + getMessage(message));
    }
    get logType() {
        return LOGGING;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Module;
    module.exports.default = Module;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Module;