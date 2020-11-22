import type { BackgroundColor, ForegroundColor } from 'chalk';

import path = require('path');
import fs = require('fs');
import chalk = require('chalk');

const getMessage = (value: unknown) => value ? ` (${value as string})` : '';

const Module = class implements functions.IModule {
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
        this.formatMessage('FAIL', value, message, 'white', 'bgRed');
    }
    formatMessage(title: string, value: string | [string, string], message?: unknown, color: typeof ForegroundColor = 'green', bgColor: typeof BackgroundColor = 'bgBlack') {
        value = Array.isArray(value) ? value[0].padEnd(30) + chalk.blackBright('[') + (value[1].length > 28 ? value[1].substring(0, 25) + '...' : chalk.blackBright('_'.repeat(28 - value[1].length)) + value[1] + chalk.blackBright(']')) : value.padEnd(60);
        this.writeMessage(title.padEnd(5), value, message, color, bgColor);
    }
    writeMessage(title: string, value: string, message?: unknown, color: typeof ForegroundColor = 'green', bgColor: typeof BackgroundColor = 'bgBlack') {
        try {
            console.log(`${chalk[bgColor].bold[color](title)}: ${value}` + getMessage(message));
        }
        catch {
            console.log(`${title}: ${value}` + getMessage(message));
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Module;
    module.exports.default = Module;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Module;