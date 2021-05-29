import type { IFileManager } from '../../types/lib';
import type { ManifestData } from '../../types/lib/android';
import type { RequestBody as IRequestBody } from '../../types/lib/node';

import type { DocumentAsset, DocumentModule, IAndroidDocument } from './document';

import path = require('path');
import fs = require('fs-extra');

import htmlparser2 = require('htmlparser2');
import domhandler = require('domhandler');
import domutils = require('domutils');
import domserializer = require('dom-serializer');

import Document from '../../document';

const Parser = htmlparser2.Parser;
const DomHandler = domhandler.DomHandler;

interface RequestBody extends IRequestBody {
    manifest?: ManifestData;
    dependencies?: string[];
}

class AndroidDocument extends Document implements IAndroidDocument {
    static async finalize(this: IFileManager, instance: IAndroidDocument) {
        const settings = instance.module.settings || {};
        settings.app_directory ||= 'app';
        if (instance.manifest) {
            const filename = instance.manifestFilename;
            const template = path.join(this.baseDirectory, settings.app_directory, 'src', 'main', filename);
            let content: Undef<string>,
                existing: Undef<boolean>;
            try {
                existing = !this.archiving && fs.existsSync(template);
                content = fs.readFileSync(existing ? template : path.resolve(__dirname, 'template', filename), 'utf8');
            }
            catch (err) {
                this.writeFail(['Unable to read file', path.basename(template)], err, this.logType.FILE);
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
                            this.writeFail(['Unable to parse file', filename], err);
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
                        this.writeFail(['Unable to write file', path.basename(template)], err, this.logType.FILE);
                    }
                }
            }
        }
        if (instance.dependencies) {
            const kotlin = settings.language?.gradle === 'kotlin';
            const filename = kotlin ? 'build.gradle.kts' : 'build.gradle';
            const template = path.join(this.baseDirectory, settings.app_directory, filename);
            let content: Undef<string>,
                existing: Undef<boolean>;
            try {
                existing = !this.archiving && fs.existsSync(template);
                content = fs.readFileSync(existing ? template : path.resolve(__dirname, 'template', kotlin ? 'kotlin' : 'java', filename), 'utf8');
            }
            catch (err) {
                this.writeFail(['Unable to read file', path.basename(template)], err, this.logType.FILE);
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
                            this.writeFail(['Unable to write file', path.basename(template)], err, this.logType.FILE);
                        }
                    }
                }
            }
        }
    }

    moduleName = 'android';
    module!: DocumentModule;
    assets: DocumentAsset[] = [];
    manifestFilename = 'AndroidManifest.xml';
    manifest?: ManifestData;
    dependencies?: string[];

    init(assets: DocumentAsset[], body: RequestBody) {
        this.assets = assets;
        this.manifest = body.manifest;
        this.dependencies = body.dependencies;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AndroidDocument;
    module.exports.default = AndroidDocument;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default AndroidDocument;