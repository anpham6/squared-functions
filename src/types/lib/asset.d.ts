import type { BundleAction, FileAsset } from './squared';

export interface FileData {
    file?: ExternalAsset;
    localUri?: string;
    mimeType?: string | false;
    outputType?: string;
}

export interface FileOutput {
    pathname: string;
    localUri: string;
}

export interface ExternalAsset extends FileAsset, BundleAction {
    localUri?: string;
    relativeUri?: string;
    cloudUrl?: string;
    buffer?: Buffer;
    sourceUTF8?: string;
    originalName?: string;
    transforms?: string[];
    etag?: string;
    invalid?: boolean;
}