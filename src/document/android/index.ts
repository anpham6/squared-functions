import type { FinalizedElement } from '../../types/lib/squared';

import type { ManifestData } from '../../types/lib/android';
import type { IFileManager } from '../../types/lib';
import type { RequestBody as IRequestBody } from '../../types/lib/node';

import type { DocumentAsset, DocumentModule, IAndroidDocument, IRequestData } from './document';

import path = require('path');
import fs = require('fs');
import readdirp = require('readdirp');

import Document from '../../document';

interface RequestBody extends IRequestBody, IRequestData {}

class AndroidDocument extends Document implements IAndroidDocument {
    static async finalize(this: IFileManager, instance: AndroidDocument) {
        const mainActivityFile = instance.mainActivityFile;
        if (mainActivityFile && !path.isAbsolute(mainActivityFile)) {
            try {
                const pathname = /[\\/]/.test(mainActivityFile) && path.join(this.baseDirectory, mainActivityFile);
                if (pathname && fs.existsSync(pathname)) {
                    instance.mainActivityFile = pathname;
                }
                else {
                    const directories = [this.baseDirectory, instance.mainParentDir, instance.mainSrcDir];
                    do {
                        const files = await readdirp.promise(path.join(...directories), { fileFilter: mainActivityFile });
                        if (files.length) {
                            instance.mainActivityFile = files[0].fullPath;
                            break;
                        }
                        directories.pop();
                    }
                    while (directories.length);
                }
            }
            catch (err) {
                this.writeFail(['Unable to locate main activity', mainActivityFile], err);
            }
        }
        return super.finalize.call(this, instance);
    }

    moduleName = 'android';
    module!: DocumentModule;
    assets: DocumentAsset[] = [];
    mainParentDir = 'app';
    mainSrcDir = 'src/main';
    mainActivityFile = '';
    host?: IFileManager;
    manifest?: ManifestData;
    dependencies?: string[];
    elements?: FinalizedElement[];

    init(assets: DocumentAsset[], body: RequestBody) {
        this.assets = assets;
        this.manifest = body.manifest;
        this.dependencies = body.dependencies;
        this.elements = body.elements;
        const { mainParentDir, mainSrcDir, mainActivityFile } = body;
        if (mainParentDir) {
            this.mainParentDir = mainParentDir;
        }
        if (mainSrcDir) {
            this.mainSrcDir = mainSrcDir;
        }
        if (mainActivityFile) {
            this.mainActivityFile = mainActivityFile;
        }
    }
    resolveTemplateDir(...paths: string[]) {
        const template = this.module.settings?.directory?.template;
        if (template) {
            return path.join(path.isAbsolute(template) ? template : path.resolve(process.cwd(), template), ...paths);
        }
    }
    resolveKts(...paths: string[]) {
        try {
            const file = path.join(...paths);
            if (fs.existsSync(file)) {
                return false;
            }
            if (fs.existsSync(file + '.kts')) {
                return true;
            }
        }
        catch {
        }
        return null;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AndroidDocument;
    module.exports.default = AndroidDocument;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default AndroidDocument;