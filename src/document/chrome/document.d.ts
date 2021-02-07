
import type { ChromeAsset } from '../../types/lib/chrome';

import type { DocumentConstructor, IDocument } from '../../types/lib';
import type { ExternalAsset } from '../../types/lib/asset';
import type { DocumentModule } from '../../types/lib/module';
import type { RequestBody } from '../../types/lib/node';

export interface DocumentAsset extends ExternalAsset, ChromeAsset {
    srcSet?: string[];
    inlineBase64?: string;
    inlineCssMap?: StringMap;
    inlineCloud?: string;
    inlineCssCloud?: string;
}

export interface IChromeDocument extends IDocument {
    assets: DocumentAsset[];
    htmlFiles: DocumentAsset[];
    cssFiles: DocumentAsset[];
    baseDirectory: string;
    baseUrl: string;
    productionRelease: boolean;
    internalServerRoot: string;
    internalAssignUUID: string;
    unusedStyles?: string[];
}

export interface ChromeDocumentConstructor extends DocumentConstructor {
    new(body: RequestBody, settings?: DocumentModule, productionRelease?: boolean): IChromeDocument;
}