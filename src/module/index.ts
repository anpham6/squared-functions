import path = require('path');
import fs = require('fs');
import chalk = require('chalk');

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
    getFileSize(filepath: string) {
        try {
            return fs.statSync(filepath).size;
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
    writeFail(description: string, message: unknown) {
        console.log(`${chalk.bgRed.bold.white('FAIL')}: ${description} (${message as string})`);
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Module;
    module.exports.default = Module;
    module.exports.__esModule = true;
}

export default Module;