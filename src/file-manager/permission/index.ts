
import type { IPermission } from '../../types/lib';
import type { PermissionSettings } from '../../types/lib/node';

const isTrue = (value: unknown): value is true => value ? value === true || value === 'true' || +(value as string) === 1 : false;

class Permission implements IPermission {
    private _disk_read: boolean;
    private _disk_write: boolean;
    private _unc_read: boolean;
    private _unc_write: boolean;

    constructor(settings: PermissionSettings = {}) {
        const { disk_read, disk_write, unc_read, unc_write } = settings;
        this._disk_read = isTrue(disk_read);
        this._disk_write = isTrue(disk_write);
        this._unc_read = isTrue(unc_read);
        this._unc_write = isTrue(unc_write);
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