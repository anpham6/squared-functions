import type { LocationUri } from './squared';
import type { DBDataSource } from './chrome';

export interface CloudService extends ObjectMap<unknown> {
    service: string;
    credential: string | PlainObject;
}

export interface CloudDatabase<T = string | PlainObject | unknown[]> extends CloudService, DBDataSource<T> {
    id?: string;
    params?: unknown[];
}

export interface CloudStorage extends CloudService {
    bucket?: string;
    admin?: CloudStorageAdmin;
    upload?: CloudStorageUpload;
    download?: CloudStorageDownload;
}

export interface CloudStorageAdmin {
    publicRead?: boolean;
    emptyBucket?: boolean;
    preservePath?: boolean;
}

export interface CloudStorageAction extends Partial<LocationUri> {
    active?: boolean;
    overwrite?: boolean;
    bucketGroup?: string;
}

export interface CloudStorageUpload extends CloudStorageAction {
    localStorage?: boolean;
    endpoint?: string;
    all?: boolean;
    publicRead?: boolean;
}

export interface CloudStorageDownload extends CloudStorageAction {
    versionId?: string;
    deleteObject?: string;
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
}

export interface UploadData extends FunctionData {
    upload: CloudStorageUpload;
    buffer: Buffer;
    localUri: string;
    fileGroup: [BufferContent, string][];
    filename?: string;
    mimeType?: string;
}

export interface DownloadData extends FunctionData {
    download: CloudStorageDownload;
}

export type CloudFeatures = "storage" | "database";
export type CloudFunctions = "upload" | "download";