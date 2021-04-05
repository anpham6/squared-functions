
import type { ChromeAsset, CssSelectorData, DocumentOutput } from '../../types/lib/chrome';

import type { IDocument } from '../../types/lib';
import type { ExternalAsset } from '../../types/lib/asset';

export interface DocumentAsset extends ExternalAsset, ChromeAsset {
    srcSet?: string[];
    inlineBase64?: string;
    inlineCssMap?: StringMap;
    inlineCloud?: string;
    inlineCssCloud?: string;
}

export interface IChromeDocument extends IDocument, DocumentOutput, CssSelectorData {
    assets: DocumentAsset[];
    htmlFile: Null<DocumentAsset>;
    cssFiles: DocumentAsset[];
    baseDirectory: string;
    internalServerRoot: string;
    internalAssignUUID: string;
    baseUrl?: string;
}