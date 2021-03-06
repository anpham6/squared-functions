import type { IFileManager } from '../../../../../types/lib';
import type { IAndroidDocument } from '../../../document';

import { ERR_MESSAGE } from '../../../../../types/lib/logger';

import path = require('path');
import fs = require('fs');

import htmlparser2 = require('htmlparser2');
import domhandler = require('domhandler');
import domutils = require('domutils');
import domserializer = require('dom-serializer');

const Parser = htmlparser2.Parser;
const DomHandler = domhandler.DomHandler;

const MANIFEST_FILENAME = 'AndroidManifest.xml';

export default function finalize(this: IFileManager, instance: IAndroidDocument, documentDir: string) {
    if (!instance.manifest) {
        return;
    }
    const template = path.join(this.baseDirectory, instance.mainParentDir, instance.mainSrcDir, MANIFEST_FILENAME);
    let content: Undef<string>,
        existing: Undef<boolean>;
    try {
        existing = !this.archiving && fs.existsSync(template);
        content = fs.readFileSync(existing ? template : instance.resolveTemplateDir(MANIFEST_FILENAME) || path.join(documentDir, instance.moduleName, 'template', MANIFEST_FILENAME), 'utf8');
    }
    catch (err) {
        this.writeFail([ERR_MESSAGE.READ_FILE, template], err, this.logType.FILE);
    }
    if (content) {
        const { package: manifestPackage = '', application: manifestApplication = {} } = instance.manifest;
        const { theme, supportRTL, activityName } = manifestApplication;
        let modified: Undef<boolean>;
        if (!existing) {
            if (theme && activityName) {
                content = content
                    .replace('{{package}}', manifestPackage)
                    .replace('{{supportsRtl}}', supportRTL === false ? 'false' : 'true')
                    .replace('{{theme}}', theme)
                    .replace('{{activityName}}', activityName);
                modified = true;
            }
        }
        else if (manifestPackage || theme || activityName || supportRTL !== undefined) {
            new Parser(new DomHandler((err, dom) => {
                if (!err) {
                    if (manifestPackage) {
                        const manifest = domutils.findOne(elem => elem.tagName === 'manifest', dom, true);
                        if (manifest) {
                            manifest.attribs['package'] = manifestPackage;
                        }
                    }
                    const application = domutils.findOne(elem => elem.tagName === 'application', dom, true);
                    if (application) {
                        if (theme) {
                            application.attribs['android:theme'] = '@style/' + theme;
                            modified = true;
                        }
                        if (activityName) {
                            for (const activity of domutils.getElementsByTagName('activity', dom, true)) {
                                const action = domutils.findOne(elem => elem.tagName === 'action' && elem.attribs['android:name'] === 'android.intent.action.MAIN', [activity], true);
                                if (action) {
                                    activity.attribs['android:name'] = activityName;
                                    modified = true;
                                    break;
                                }
                            }
                        }
                        if (supportRTL !== undefined) {
                            application.attribs['android:supportsRtl'] = supportRTL.toString();
                            modified = true;
                        }
                        if (modified) {
                            content = domserializer.default(dom, { xmlMode: true });
                        }
                    }
                }
                else {
                    this.writeFail(['Unable to parse XML document', MANIFEST_FILENAME], err);
                }
            }), { xmlMode: true, decodeEntities: false }).end(content);
        }
        if (modified) {
            try {
                fs.writeFileSync(template, content, 'utf8');
                if (!existing) {
                    this.add(template);
                }
            }
            catch (err) {
                this.writeFail([ERR_MESSAGE.WRITE_FILE, template], err, this.logType.FILE);
            }
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = finalize;
    module.exports.default = finalize;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}