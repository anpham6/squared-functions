import type { IDocument } from '../../types/lib';
import type { ManifestData } from '../../types/lib/android';
import type { ExternalAsset } from '../../types/lib/asset';
import type { DocumentModule as IDocumentModule } from '../../types/lib/module';

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

export interface IAndroidDocument extends IDocument {
    module: DocumentModule;
    assets: DocumentAsset[];
    manifestFilename: string;
    manifest?: ManifestData;
    dependencies?: string[];
}