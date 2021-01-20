/// <reference path="type.d.ts" />

interface ElementScope {
    watch?: boolean | WatchInterval;
    tasks?: TaskAction[];
}

interface Asset extends ElementScope {
    uri?: string;
    mimeType?: string;
}

interface TextAsset extends Asset, LocationUri {
    content?: string;
}

export interface OutputAction {
    moveTo?: string;
    commands?: string[];
    compress?: CompressFormat[];
    document?: string | string[];
    cloudStorage?: CloudStorage[];
}

export interface TaskAction {
    handler: string;
    task: string;
    preceding?: boolean;
}

export interface BundleAction {
    bundleId?: number;
    bundleIndex?: number;
    bundleRoot?: string;
    trailingContent?: string[];
}

export interface ElementAction {
    element?: ElementIndex;
}

export interface ElementIndex {
    outerHTML: string;
    outerIndex: number;
    tagName: string;
    tagIndex: number;
}

export interface LocationUri {
    pathname: string;
    filename: string;
}

export interface FileAsset extends TextAsset, OutputAction {
    base64?: string;
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

export interface CloudDatabase<T = string | PlainObject | any[]> extends CloudService, ElementAction {
    value: string | ObjectMap<string | string[]>;
    table?: string;
    name?: string;
    id?: string;
    query?: T;
    limit?: number;
    params?: unknown[];
    options?: PlainObject;
    document?: string | string[];
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

export interface RequestData extends PlainObject {
    assets?: FileAsset[];
    database?: CloudDatabase[];
    document?: string[];
    task?: string[];
}

export interface ResponseData {
    success: boolean;
    data?: unknown;
    filename?: string;
    downloadKey?: string;
    downloadUrl?: string;
    bytes?: number;
    files?: string[];
    error?: ResponseError;
}

export interface ResponseError {
    message: string;
    hint?: string;
}