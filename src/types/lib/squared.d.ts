/// <reference path="type.d.ts" />
/// <reference path="dom.d.ts" />

interface ElementScope {
    watch?: WatchValue;
    tasks?: TaskAction[];
}

interface Asset extends ElementScope {
    uri?: string;
    mimeType?: string;
}

interface TextAsset extends Asset, LocationUri {
    content?: string;
}

export interface FileInfo {
    name: string;
    size: string;
}

export interface DataSource extends DocumentAction {
    source: string;
    index?: number;
    limit?: number;
    query?: unknown;
    postQuery?: string;
    preRender?: string;
    removeEmpty?: boolean;
}

export interface OutputAction extends DocumentAction {
    moveTo?: string;
    process?: string[];
    commands?: string[];
    compress?: CompressFormat[];
    willChange?: boolean;
}

export interface TaskAction {
    handler: string;
    task: string;
    preceding?: boolean;
}

export interface BundleAction {
    bundleId?: number;
    bundleIndex?: number;
    bundleReplace?: string;
    bundleQueue?: Promise<unknown>[];
    trailingContent?: string[];
}

export interface DocumentAction {
    document?: StringOfArray;
}

export interface AttributeAction {
    attributes?: AttributeMap;
}

export interface StorageAction<T = unknown> {
    cloudStorage?: T[];
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
    nextSibling?: number;
}

export interface XmlNode extends AttributeAction {
    index?: number;
    outerXml?: string;
    innerXml?: string;
    ignoreCase?: boolean;
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

export interface FileAsset extends TextAsset, OutputAction {
    format?: string;
    base64?: string;
}

export interface ViewEngine {
    name: string;
    singleRow?: boolean;
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

export interface WatchInterval<T = FileAsset> {
    id?: string;
    interval?: number;
    expires?: string;
    reload?: WatchReload;
    assets?: T[];
}

export interface WatchReload {
    socketId: string;
    secure?: boolean;
    port?: number;
    module?: boolean;
}

export interface RequestData extends PlainObject {
    assets?: FileAsset[];
    imports?: StringMap;
    dataSource?: DataSource[];
    document?: string[];
    update?: WatchInterval;
    task?: string[];
}

export interface ResponseData {
    success: boolean;
    data?: unknown;
    filename?: string;
    downloadKey?: string;
    downloadUrl?: string;
    bytes?: number;
    files?: FileInfo[];
    error?: ResponseError;
}

export interface ResponseError {
    message: string;
    hint?: string;
}

export interface FinalizedElement {
    documentId: string;
    bounds: BoxRectDimension;
    css: CssStyleMap;
    outerWrapperIds?: string[];
}

export interface ControllerSettingsDirectoryUI {
    layout: string;
    string: string;
    font: string;
    image: string;
    video: string;
    audio: string;
}

export type AttributeMap = ObjectMap<Optional<string>>;
export type WatchValue = boolean | WatchInterval;