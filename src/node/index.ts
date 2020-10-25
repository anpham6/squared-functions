import Module from '../module';

const REGEXP_URL = /^([A-Za-z]+:\/\/[A-Za-z\d.-]+(?::\d+)?)(\/.*)/;

export default new class extends Module implements functions.INode {
    private _disk_read = false;
    private _disk_write = false;
    private _unc_read = false;
    private _unc_write = false;

    enableReadDisk() {
        this._disk_read = true;
    }
    enableWriteDisk() {
        this._disk_write = true;
    }
    enableReadUNC() {
        this._unc_read = true;
    }
    enableWriteUNC() {
        this._unc_write = true;
    }
    canReadDisk() {
        return this._disk_read;
    }
    canWriteDisk() {
        return this._disk_write;
    }
    canReadUNC() {
        return this._unc_read;
    }
    canWriteUNC() {
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
    fromSameOrigin(base: string, other: string) {
        const baseMatch = REGEXP_URL.exec(base);
        const otherMatch = REGEXP_URL.exec(other);
        return baseMatch && otherMatch ? baseMatch[1] === otherMatch[1] : false;
    }
    parsePath(value: string) {
        return REGEXP_URL.exec(value)?.[2];
    }
    resolvePath(value: string, href: string, hostname = true) {
        const match = REGEXP_URL.exec(href.replace(/\\/g, '/'));
        if (match) {
            const origin = hostname ? match[1] : '';
            const pathname = match[2].split('/');
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
            return origin + pathname.join('/') + '/' + value;
        }
    }
}();