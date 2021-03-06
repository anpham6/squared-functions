import type { IPermission } from '../../types/lib';

class Permission implements IPermission {
    private _disk_read = false;
    private _disk_write = false;
    private _unc_read = false;
    private _unc_write = false;

    setDiskRead() {
        this._disk_read = true;
    }
    setDiskWrite() {
        this._disk_write = true;
    }
    setUNCRead() {
        this._unc_read = true;
    }
    setUNCWrite() {
        this._unc_write = true;
    }
    hasDiskRead() {
        return this._disk_read;
    }
    hasDiskWrite() {
        return this._disk_write;
    }
    hasUNCRead() {
        return this._unc_read;
    }
    hasUNCWrite() {
        return this._unc_write;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Permission;
    module.exports.default = Permission;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Permission;