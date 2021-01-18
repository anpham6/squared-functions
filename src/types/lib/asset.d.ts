import type { BundleAction, FileAsset } from './squared';

export interface FileData {
    file: ExternalAsset;
    mimeType?: string | false;
}

export interface FileOutput {
    pathname: string;
    localUri: string;
}

export interface ExternalAsset extends FileAsset, BundleAction {
    localUri?: string;
    relativeUri?: string;
    cloudUri?: string;
    buffer?: Buffer;
    sourceUTF8?: string;
    originalName?: string;
    transforms?: string[];
    etag?: string;
    invalid?: boolean;
}