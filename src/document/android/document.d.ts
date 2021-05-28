import type { IDocument } from '../../types/lib';
import type { ExternalAsset } from '../../types/lib/asset';
import type { DocumentModule as IDocumentModule } from '../../types/lib/module';

export interface DocumentModule extends IDocumentModule {
    settings?: {
        app_directory?: string;
    };
}

export interface DocumentAsset extends ExternalAsset {}

export interface IAndroidDocument extends IDocument {
    module: DocumentModule;
    assets: DocumentAsset[];
    dependencies?: string[];
}