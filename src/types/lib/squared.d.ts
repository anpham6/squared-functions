/// <reference path="type.d.ts" />

export interface LocationUri {
    pathname: string;
    filename: string;
}

export interface FileAsset extends LocationUri {
    moveTo?: string;
    content?: string;
    uri?: string;
    mimeType?: string;
    base64?: string;
    commands?: string[];
    compress?: CompressFormat[];
    document?: string[];
    cloudStorage?: CloudStorage[];
    watch?: boolean | WatchInterval;
    tasks?: string[];
}

export interface CompressFormat {
    format: string;
    level?: number;
    condition?: string;
    plugin?: string;
    options?: PlainObject;
}

export interface CloudService extends ObjectMap<unknown> {
    service: string;
    credential: string | PlainObject;
}

export interface CloudDatabase<T = string | PlainObject | any[]> extends CloudService {
    table: string;
    value: string | ObjectMap<string | string[]>;
    name?: string;
    id?: string;
    query?: T;
    limit?: number;
    params?: unknown[];
    options?: PlainObject;
    element?: {
        outerHTML?: string;
    };
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

export interface WatchInterval {
    interval?: number;
    expires?: string;
}

export interface ResponseData {
    success: boolean;
    data?: unknown;
    zipname?: string;
    downloadKey?: string;
    bytes?: number;
    files?: string[];
    error?: ResponseError;
}

export interface ResponseError {
    message: string;
    hint?: string;
}