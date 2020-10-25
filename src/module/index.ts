import fs = require('fs');
import chalk = require('chalk');

export default class implements functions.IModule {
    public major: number;
    public minor: number;
    public patch: number;

    constructor() {
        [this.major, this.minor, this.patch] = process.version.substring(1).split('.').map(value => parseInt(value));
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
    writeFail(description: string, message: any) {
        console.log(`${chalk.bgRed.bold.white('FAIL')}: ${description} (${message as string})`);
    }
}