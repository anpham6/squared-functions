import type { BundleAction, FileAsset } from './squared';

export interface FileData {
    file: ExternalAsset;
    saveAs?: string;
    command?: string;
    tempUri?: string;
    mimeType?: string;
    outputType?: string;
}

export interface FileCopy {
    tempUri: string;
    saveAs: string;
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