
import type { DocumentConstructor, ExtendedSettings, ExternalAsset, IDocument, RequestBody } from '../../types/lib';
import type { ChromeAsset } from '../../types/lib/chrome';

export interface DocumentAsset extends ExternalAsset, ChromeAsset {
    srcSet?: string[];
    inlineBase64?: string;
    inlineCssMap?: StringMap;
    inlineCloud?: string;
    inlineCssCloud?: string;
}

export interface IChromeDocument extends IDocument {
    productionRelease: boolean;
    htmlFiles: DocumentAsset[];
    cssFiles: DocumentAsset[];
    baseDirectory: string;
    internalServerRoot: string;
    baseUrl?: string;
    unusedStyles?: string[];
}

export interface ChromeDocumentConstructor extends DocumentConstructor {
    new(body: RequestBody, settings?: ExtendedSettings.DocumentModule, productionRelease?: boolean): IChromeDocument;
}