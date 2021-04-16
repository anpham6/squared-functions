import type { IPermission } from '../../types/lib';

import path = require('path');
import mm = require('micromatch');

function convertPosix(value: Undef<StringOfArray>) {
    if (value) {
        if (typeof value === 'string') {
            value = [value];
        }
        return path.sep === '\\' ? value.map(item => item.replace(/\\/g, '/')) : value;
    }
}

const asPosix = (value: string) => path.sep === '\\' ? value.replace(/\\/g, '/') : value;

class Permission implements IPermission {
    private _disk_read = false;
    private _disk_write = false;
    private _unc_read = false;
    private _unc_write = false;

    private _DISK_READ?: string[];
    private _DISK_WRITE?: string[];
    private _UNC_READ?: string[];
    private _UNC_WRITE?: string[];

    setDiskRead(pathname?: StringOfArray) {
        this._disk_read = true;
        this._DISK_READ = convertPosix(pathname);
    }
    setDiskWrite(pathname?: StringOfArray) {
        this._disk_write = true;
        this._DISK_WRITE = convertPosix(pathname);
    }
    setUNCRead(pathname?: StringOfArray) {
        this._unc_read = true;
        this._UNC_READ = convertPosix(pathname);
    }
    setUNCWrite(pathname?: StringOfArray) {
        this._unc_write = true;
        this._UNC_WRITE = convertPosix(pathname);
    }
    hasDiskRead(value: string) {
        return this._disk_read && (!this._DISK_READ || mm.isMatch(asPosix(value), this._DISK_READ));
    }
    hasDiskWrite(value: string) {
        return this._disk_write && (!this._DISK_WRITE || mm.isMatch(asPosix(value), this._DISK_WRITE));
    }
    hasUNCRead(value: string) {
        return this._unc_read && (!this._UNC_READ || mm.isMatch(asPosix(value), this._UNC_READ));
    }
    hasUNCWrite(value: string) {
        return this._unc_write && (!this._UNC_WRITE || mm.isMatch(asPosix(value), this._UNC_WRITE));
    }
    get diskRead() {
        return this._disk_read;
    }
    get diskWrite() {
        return this._disk_write;
    }
    get uncRead() {
        return this._unc_read;
    }
    get uncWrite() {
        return this._unc_write;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Permission;
    module.exports.default = Permission;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Permission;