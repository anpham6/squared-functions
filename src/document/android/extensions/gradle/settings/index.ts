import type { IFileManager } from '../../../../../types/lib';

import type { IAndroidDocument } from '../../../document';

import path = require('path');
import fs = require('fs');

export default function finalize(this: IFileManager, instance: IAndroidDocument, documentDir: string) {
    if (!instance.dependencies) {
        return;
    }
    const baseDir = this.baseDirectory;
    let filename = 'settings.gradle';
    const kotlin = (!this.archiving ? instance.resolveKts(baseDir, filename) : null) ?? instance.module.settings?.language?.gradle === 'kotlin';
    if (kotlin) {
        filename += '.kts';
    }
    const template = path.join(baseDir, filename);
    let content: Undef<string>,
        existing: Undef<boolean>;
    try {
        existing = !this.archiving && fs.existsSync(template);
        content = fs.readFileSync(existing ? template : instance.resolveTemplateDir(kotlin ? 'kotlin' : 'java', filename) || path.resolve(documentDir, instance.moduleName, 'template', kotlin ? 'kotlin' : 'java', filename), 'utf8');
    }
    catch (err) {
        this.writeFail(['Unable to read file', template], err, this.logType.FILE);
    }
    if (content) {
        const mainParentDir = instance.mainParentDir;
        let modified: Undef<boolean>;
        if (existing) {
            found: {
                const pattern = kotlin ? /include\((\s*"[^"]+"\s*,?\s*)+\)/g : /include\s+((?:"[^"]+"|'[^']+')\s*,?\s*)+/g;
                let match: Null<RegExpExecArray>;
                while (match = pattern.exec(content)) {
                    const namespace = /":?([^"]+)"|':?([^']+)'/g;
                    let app: Null<RegExpExecArray>;
                    while (app = namespace.exec(match[1])) {
                        if (app[1] === mainParentDir || app[2] === mainParentDir) {
                            break found;
                        }
                    }
                }
                pattern.lastIndex = 0;
                if (match = pattern.exec(content)) {
                    const index = match.index + match[0].length;
                    if (kotlin) {
                        content = content.substring(0, index - 1).trimEnd() + `, "${mainParentDir}")` + content.substring(index);
                    }
                    else {
                        content = content.substring(0, index).trimEnd() + `, '${mainParentDir}'` + content.substring(index);
                    }
                    modified = true;
                }
            }
        }
        else {
            content = content.replace('{{name}}', mainParentDir);
        }
        if (modified || !existing) {
            try {
                fs.writeFileSync(template, content, 'utf8');
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = finalize;
    module.exports.default = finalize;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}