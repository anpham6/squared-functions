import type { ChromeAsset, CssSelectorData, DocumentOutput } from '../../types/lib/chrome';

import type { IDocument } from '../../types/lib';
import type { ExternalAsset } from '../../types/lib/asset';
import type { DocumentModule as IDocumentModule } from '../../types/lib/module';

export interface DocumentModule extends IDocumentModule {
    format_uuid?: {
        pathname?: string;
        filename?: string;
    };
    settings?: {
        transform?: StandardMap;
        view_engine?: StandardMap;
        mongodb?: StandardMap;
    };
}

export interface DocumentAsset extends ExternalAsset, ChromeAsset {
    srcSet?: string[];
    inlineBase64?: string;
    inlineCssMap?: StringMap;
    inlineCloud?: string;
    inlineCssCloud?: string;
}

export interface IChromeDocument extends IDocument, DocumentOutput, CssSelectorData {
    module: DocumentModule;
    assets: DocumentAsset[];
    htmlFile: Null<DocumentAsset>;
    cssFiles: DocumentAsset[];
    baseDirectory: string;
    internalServerRoot: string;
    internalAssignUUID: string;
    baseUrl?: string;
    removeServerRoot(value: string): string;
}