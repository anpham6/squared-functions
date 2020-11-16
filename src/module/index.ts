import path = require('path');
import fs = require('fs');
import chalk = require('chalk');

const getMessage = (value: unknown) => value !== undefined && value !== null ? ` (${value as string})` : '';

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
    writeMessage(value: string, message?: unknown, title = 'SUCCESS', color: "green" | "yellow" | "blue" | "white" | "grey" = 'green') {
        try {
            console.log(`${chalk.bold[color](title)}: ${value}` + getMessage(message));
        }
        catch {
            console.log(`${title}: ${value}` + getMessage(message));
        }
    }
    writeFail(value: string, message?: unknown) {
        console.log(`${chalk.bgRed.bold.white('FAIL')}: ${value}` + getMessage(message));
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Module;
    module.exports.default = Module;
    module.exports.__esModule = true;
}

export default Module;