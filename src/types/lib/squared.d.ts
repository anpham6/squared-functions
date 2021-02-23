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

export interface DataSource extends ElementAction, DocumentAction, PlainObject {
    source: "uri" | "cloud";
    index?: number;
    limit?: number;
    query?: unknown;
    removeEmpty?: boolean;
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
    element?: XmlTagNode;
}

export interface TagData {
    tagName: string;
    tagCount?: number;
    tagIndex?: number;
}

export interface TagAppend extends TagData {
    order: number;
    id?: string;
    textContent?: string;
    prepend?: boolean;
}

export interface XmlNode extends AttributeAction {
    index?: number;
    outerXml?: string;
    innerXml?: string;
    lowerCase?: boolean;
}

export interface XmlTagNode extends XmlNode, TagData {
    id?: StringMap;
    textContent?: string;
    append?: TagAppend;
    removed?: boolean;
}

export interface LocationUri {
    pathname: string;
    filename: string;
}

export interface FileAsset<T = unknown> extends TextAsset, OutputAction<T> {
    base64?: string;
}

export interface ViewEngine {
    name: string;
    options?: {
        compile?: PlainObject;
        output?: PlainObject;
    };
}

export interface CompressLevel {
    level?: number;
    chunkSize?: number;
    mimeType?: string;
}

export interface CompressFormat extends CompressLevel {
    format: string;
    condition?: string;
    plugin?: string;
    options?: PlainObject;
}

export interface WatchInterval {
    interval?: number;
    expires?: string;
}

export interface RequestData extends PlainObject {
    assets?: FileAsset[];
    dataSource?: DataSource[];
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