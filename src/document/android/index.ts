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
            const mainParentDir = path.join(this.baseDirectory, instance.mainParentDir);
            let found: Undef<boolean>;
            if (/[\\/]/.test(mainActivityFile)) {
                const pathname = path.join(mainParentDir, mainActivityFile);
                try {
                    if (fs.existsSync(pathname)) {
                        instance.mainActivityFile = pathname;
                        found = true;
                    }
                }
                catch {
                }
            }
            if (!found) {
                const files = await readdirp.promise(mainParentDir, { fileFilter: mainActivityFile });
                if (files.length) {
                    instance.mainActivityFile = files[0].fullPath;
                }
            }
        }
        return super.finalize.call(this, instance);
    }

    moduleName = 'android';
    module!: DocumentModule;
    assets: DocumentAsset[] = [];
    mainParentDir = 'app';
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
        const mainParentDir = body.mainParentDir || this.module.settings?.directory?.main;
        if (mainParentDir) {
            this.mainParentDir = mainParentDir;
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