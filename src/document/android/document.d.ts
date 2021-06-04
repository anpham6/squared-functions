import type { FinalizedElement } from '../../types/lib/squared';

import type { IDocument } from '../../types/lib';
import type { ManifestData } from '../../types/lib/android';
import type { ExternalAsset } from '../../types/lib/asset';
import type { DocumentModule as IDocumentModule } from '../../types/lib/module';

export interface IRequestData {
    manifest?: ManifestData;
    dependencies?: string[];
    elements?: FinalizedElement[];
    mainParentDir?: string;
    mainActivityFile?: string;
}

export interface DocumentModule extends IDocumentModule {
    settings?: {
        language?: {
            gradle?: "java" | "kotlin";
        };
        directory?: SettingsDirectory;
    };
}

export interface SettingsDirectory {
    main?: string;
    template?: string;
}

export interface DocumentAsset extends ExternalAsset {}

export interface IAndroidDocument extends IDocument, IRequestData {
    module: DocumentModule;
    assets: DocumentAsset[];
    mainParentDir: string;
    resolveTemplate(...paths: string[]): Undef<string>;
}