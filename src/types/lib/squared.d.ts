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

export interface OutputAction<T = unknown> extends DocumentAction {
    moveTo?: string;
    commands?: string[];
    compress?: CompressFormat[];
    cloudStorage?: T[];
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

export interface DocumentAction {
    document?: StringOfArray;
}

export interface AttributeAction {
    attributes?: AttributeMap;
}

export interface ElementAction {
    element?: ElementIndex;
}

export interface TagIndex {
    tagName: string;
    tagCount: number;
    tagIndex?: number;
}

export interface TagAppend extends TagIndex {
    textContent?: string;
    order: number;
}

export interface ElementIndex extends Required<TagIndex>, AttributeAction {
    domIndex: number;
    id?: StringMap;
    outerHTML?: string;
    innerHTML?: string;
    textContent?: string;
    append?: TagAppend;
    prepend?: TagAppend;
}

export interface LocationUri {
    pathname: string;
    filename: string;
}

export interface FileAsset<T = unknown> extends TextAsset, OutputAction<T> {
    base64?: string;
}

export interface CompressFormat {
    format: string;
    level?: number;
    condition?: string;
    plugin?: string;
    options?: PlainObject;
}

export interface WatchInterval {
    interval?: number;
    expires?: string;
}

export interface RequestData<T = unknown> extends PlainObject {
    assets?: FileAsset[];
    database?: T[];
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

export type AttributeMap = ObjectMap<Optional<string>>;