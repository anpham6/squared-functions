import type { CloudStorageAdmin, CloudStorageDownload, CloudStorageUpload } from './squared';

import type { ExternalAsset } from './asset';

export interface FinalizeResult {
    compressed: ExternalAsset[];
}

export interface CacheTimeout {
    aws?: number;
    azure?: number;
    gcloud?: number;
    ibm?: number;
    oci?: number;
}

export interface FunctionData {
    admin?: CloudStorageAdmin;
    bucket?: string;
    bucketGroup?: string;
}

export interface UploadData extends FunctionData {
    upload: CloudStorageUpload;
    buffer: Buffer;
    localUri: string;
    fileGroup: [Buffer | string, string][];
    filename?: string;
    mimeType?: string;
}

export interface DownloadData extends FunctionData {
    download: CloudStorageDownload;
}

export type CloudFeatures = "storage" | "database";
export type CloudFunctions = "upload" | "download";