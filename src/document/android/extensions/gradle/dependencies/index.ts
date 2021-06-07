import type { IFileManager } from '../../../../../types/lib';

import type { IAndroidDocument } from '../../../document';

import path = require('path');
import fs = require('fs');

export default function finalize(this: IFileManager, instance: IAndroidDocument) {
    if (instance.dependencies) {
        const settings = instance.module.settings || {};
        const mainParentDir = instance.mainParentDir;
        const kotlin = settings.language?.gradle === 'kotlin';
        const filename = kotlin ? 'build.gradle.kts' : 'build.gradle';
        const template = path.join(this.baseDirectory, mainParentDir, filename);
        let content: Undef<string>,
            existing: Undef<boolean>;
        try {
            existing = !this.archiving && fs.existsSync(template);
            content = fs.readFileSync(existing ? template : instance.resolveTemplate(kotlin ? 'kotlin' : 'java', filename) || path.resolve(__dirname, 'template', kotlin ? 'kotlin' : 'java', filename), 'utf8');
        }
        catch (err) {
            this.writeFail(['Unable to read file', template], err, this.logType.FILE);
        }
        if (content) {
            const items = instance.dependencies.map(item => item.split(':')) as [string, string, string][];
            const match = /dependencies\s+\{([^}]+)\}/.exec(content);
            if (match) {
                const writeImpl = (item: string[]) => 'implementation' + (kotlin ? `("${item.join(':')}")` : ` '${item.join(':')}'`);
                const pattern = kotlin ? /([ \t]*)implementation\((?:"([^"]+)"\))?/g : /([ \t]*)implementation\s+(?:["']([^"']+)["']|((?:\s*(?:group|name|version)\s*:\s*["'][^"']+["']\s*,?){3}))?/g;
                let source = match[1],
                    indent = '\t',
                    modified: Undef<boolean>,
                    impl: Null<RegExpExecArray>;
                while (impl = pattern.exec(match[1])) {
                    let group: Undef<string>,
                        name: Undef<string>,
                        version: Undef<string>;
                    if (impl[2]) {
                        [group, name, version] = impl[2].trim().split(':').map(item => item.trim());
                    }
                    else if (impl[3]) {
                        const method = /(group|name|version)\s*:\s*["']([^"']+)["']/g;
                        let param: Null<RegExpExecArray>;
                        while (param = method.exec(impl[3])) {
                            const value = param[2].trim();
                            switch (param[1]) {
                                case 'group':
                                    group = value;
                                    break;
                                case 'name':
                                    name = value;
                                    break;
                                case 'version':
                                    version = value;
                                    break;
                            }
                        }
                    }
                    if (group && name) {
                        let found = 0,
                            index = -1;
                        if (version) {
                            index = items.findIndex(seg => seg[0] === group && seg[1] === name);
                            if (index !== -1) {
                                const upgrade = items[index][2].split('.').map(seg => +seg);
                                const parts = version.split('.');
                                found = 1;
                                for (let i = 0, value: number; i < parts.length; ++i) {
                                    if (isNaN(value = +parts[i]) || +upgrade[i] > value) {
                                        found = 2;
                                        break;
                                    }
                                }
                            }
                        }
                        if (found) {
                            if (found === 2) {
                                source = source.replace(impl[0], writeImpl(items[index]));
                                modified = true;
                            }
                            items.splice(index, 1);
                        }
                    }
                    if (impl[1]) {
                        indent = impl[1];
                    }
                }
                if (items.length) {
                    source = items.reduce((a, b) => a + indent + writeImpl(b)+ '\n', source);
                    modified = true;
                }
                if (modified || !existing) {
                    try {
                        fs.writeFileSync(template, content.substring(0, match.index) + `dependencies {${source}}` + content.substring(match.index + match[0].length), 'utf8');
                        if (!existing) {
                            this.add(template);
                        }
                    }
                    catch (err) {
                        this.writeFail(['Unable to write file', template], err, this.logType.FILE);
                    }
                }
            }
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = finalize;
    module.exports.default = finalize;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}