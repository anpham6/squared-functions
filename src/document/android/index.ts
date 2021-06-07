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
            const pathname = /[\\/]/.test(mainActivityFile) ? path.join(this.baseDirectory, mainActivityFile) : path.join(this.baseDirectory, instance.mainParentDir, instance.mainSrcDir, mainActivityFile);
            try {
                if (fs.existsSync(pathname)) {
                    instance.mainActivityFile = pathname;
                }
                else {
                    const files = await readdirp.promise(path.join(this.baseDirectory, instance.mainParentDir), { fileFilter: mainActivityFile });
                    if (files.length) {
                        instance.mainActivityFile = files[0].fullPath;
                    }
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
    host?: IFileManager;
    manifest?: ManifestData;
    dependencies?: string[];
    elements?: FinalizedElement[];
    mainActivityFile?: string;

    init(assets: DocumentAsset[], body: RequestBody) {
        this.assets = assets;
        this.manifest = body.manifest;
        this.dependencies = body.dependencies;
        this.elements = body.elements;
        if (body.mainParentDir) {
            this.mainParentDir = body.mainParentDir;
        }
        if (body.mainSrcDir) {
            this.mainSrcDir = body.mainSrcDir;
        }
        this.mainActivityFile = body.mainActivityFile;
    }
    resolveTemplate(...paths: string[]) {
        const template = this.module.settings?.directory?.template;
        if (template) {
            return path.join(path.isAbsolute(template) ? template : path.resolve(process.cwd(), template), ...paths);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AndroidDocument;
    module.exports.default = AndroidDocument;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default AndroidDocument;