/// <reference path="type.d.ts" />

export type UnusedStyles = string[];

export interface ChromeAsset {
    rootDir?: string;
    format?: string;
    preserve?: boolean;
    exclude?: boolean;
    outerHTML?: string;
    inlineContent?: string;
    attributes?: ObjectMap<Optional<string>>;
}

export interface TemplateMap {
    html: ObjectMap<PlainObject>;
    js: ObjectMap<PlainObject>;
    css: ObjectMap<PlainObject>;
}

export interface RequestData {
    baseUrl?: string;
    templateMap?: TemplateMap;
    unusedStyles?: string[];
}