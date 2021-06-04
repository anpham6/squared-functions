import type { FinalizedElement } from '../../types/lib/squared';

import type { IFileManager } from '../../types/lib';
import type { ManifestData } from '../../types/lib/android';
import type { RequestBody as IRequestBody } from '../../types/lib/node';

import type { DocumentAsset, DocumentModule, IAndroidDocument, IRequestData, TransformCallback } from './document';

import path = require('path');

import Document from '../../document';

interface RequestBody extends IRequestBody, IRequestData {}

class AndroidDocument extends Document implements IAndroidDocument {
    static async finalize(this: IFileManager, instance: IAndroidDocument) {
        for (const ext of instance.module.extensions || []) {
            try {
                await (require(ext) as TransformCallback).call(this, instance);
            }
            catch (err) {
                this.writeFail(['Unable to load extension', ext], err);
            }
        }
    }

    moduleName = 'android';
    module!: DocumentModule;
    assets: DocumentAsset[] = [];
    manifest?: ManifestData;
    dependencies?: string[];
    elements?: FinalizedElement[];

    init(assets: DocumentAsset[], body: RequestBody) {
        this.assets = assets;
        this.manifest = body.manifest;
        this.dependencies = body.dependencies;
        this.elements = body.elements;
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