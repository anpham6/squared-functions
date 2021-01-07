/// <reference path="type.d.ts" />

export type UnusedStyles = string[];

export interface ChromeAsset {
    rootDir?: string;
    format?: string;
    preserve?: boolean;
    outerHTML?: string;
    inlineContent?: string;
    attributes?: ObjectMap<Undef<Null<string>>>;
}

export interface TemplateeMap {
    html: ObjectMap<PlainObject>;
    js: ObjectMap<PlainObject>;
    css: ObjectMap<PlainObject>;
}