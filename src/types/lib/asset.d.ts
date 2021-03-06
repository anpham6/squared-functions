import type { BundleAction, FileAsset, StorageAction } from './squared';

import type { CloudStorage } from './cloud';

export interface FileProcessing<T = ExternalAsset> {
    file: T;
    mimeType?: string;
    command?: string;
    outputType?: string;
}

export interface OutputFinalize<T = ExternalAsset> extends FileProcessing<T> {
    output: string;
    command: string;
    baseDirectory: string;
}

export interface FileOutput {
    pathname: string;
    localUri: string;
}

export interface ExternalAsset<T = CloudStorage> extends FileAsset, BundleAction, StorageAction<T> {
    url?: URL;
    localUri?: string;
    relativeUri?: string;
    cloudUrl?: string;
    buffer?: Buffer;
    sourceUTF8?: string;
    originalName?: string;
    transforms?: string[];
    sourceFiles?: string[];
    etag?: string;
    contentLength?: number;
    invalid?: boolean;
}