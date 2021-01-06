import type { ResponseData } from '../types/lib/squared';

import Module from '../module';

const Node = new class extends Module implements functions.INode {
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
    isFileURI(value: string) {
        return /^[A-Za-z]{3,}:\/\/[^/]/.test(value) && !value.startsWith('file:');
    }
    isFileUNC(value: string) {
        return /^\\\\([\w.-]+)\\([\w-]+\$?)((?<=\$)(?:[^\\]*|\\.+)|\\.+)$/.test(value);
    }
    isDirectoryUNC(value: string) {
        return /^\\\\([\w.-]+)\\([\w-]+\$|[\w-]+\$\\.+|[\w-]+\\.*)$/.test(value);
    }
    isUUID(value: string) {
        return /[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/.test(value);
    }
    getResponseError(hint: string, message: Error | string) {
        return {
            success: false,
            error: {
                hint,
                message: message.toString()
            }
        } as ResponseData;
    }
    resolvePath(value: string, href: string) {
        if (href.startsWith('http')) {
            const url = new URL(href);
            const origin = url.origin;
            const pathname = url.pathname.split('/');
            --pathname.length;
            value = value.replace(/\\/g, '/');
            if (value[0] === '/') {
                return origin + value;
            }
            else if (value.startsWith('../')) {
                const trailing: string[] = [];
                for (const dir of value.split('/')) {
                    if (dir === '..') {
                        if (trailing.length === 0) {
                            pathname.pop();
                        }
                        else {
                            --trailing.length;
                        }
                    }
                    else {
                        trailing.push(dir);
                    }
                }
                value = trailing.join('/');
            }
            return this.joinPosix(origin, pathname.join('/'), value);
        }
        return '';
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Node;
    module.exports.default = Node;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Node;