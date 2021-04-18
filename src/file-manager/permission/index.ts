import type { IPermission } from '../../types/lib';

import path = require('path');
import pm = require('picomatch');

function convertPosix(value: Undef<StringOfArray>) {
    if (value) {
        if (isString(value)) {
            value = [value];
        }
        else if (!Array.isArray(value)) {
            return [];
        }
        return path.sep === '\\' ? value.map(item => item.replace(/\\/g, '/')) : value;
    }
}

const asPosix = (value: string) => path.sep === '\\' ? value.replace(/\\/g, '/') : value;
const isString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

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
    hasDiskRead(value: unknown) {
        return this._disk_read && isString(value) && (!this._DISK_READ || pm.isMatch(asPosix(value), this._DISK_READ, { nocase: path.sep === '\\' }));
    }
    hasDiskWrite(value: unknown) {
        return this._disk_write && isString(value) && (!this._DISK_WRITE || pm.isMatch(asPosix(value), this._DISK_WRITE, { nocase: path.sep === '\\' }));
    }
    hasUNCRead(value: unknown) {
        return this._unc_read && isString(value) && (!this._UNC_READ || pm.isMatch(asPosix(value), this._UNC_READ, { nocase: path.sep === '\\' }));
    }
    hasUNCWrite(value: unknown) {
        return this._unc_write && isString(value) && (!this._UNC_WRITE || pm.isMatch(asPosix(value), this._UNC_WRITE, { nocase: path.sep === '\\' }));
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