import type { BundleAction, FileAsset } from './squared';
import type { CloudStorage } from './cloud';

export interface FileData<T = ExternalAsset> {
    file: T;
    mimeType?: string;
    command?: string;
    outputType?: string;
}

export interface OutputData<T = ExternalAsset> extends FileData<T> {
    output: string;
    command: string;
    baseDirectory: string;
}

export interface FileOutput {
    pathname: string;
    localUri: string;
}

export interface ExternalAsset extends FileAsset<CloudStorage>, BundleAction {
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