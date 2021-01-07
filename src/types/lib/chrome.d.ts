/// <reference path="type.d.ts" />

export type UnusedStyles = string[];

export interface ChromeAsset {
    rootDir?: string;
    moveTo?: string;
    format?: string;
    preserve?: boolean;
    exclude?: boolean;
    baseUrl?: string;
    bundleId?: number;
    bundleIndex?: number;
    bundleRoot?: string;
    outerHTML?: string;
    trailingContent?: FormattableContent[];
    inlineContent?: string;
    attributes?: ObjectMap<Undef<Null<string>>>;
}

export interface FormattableContent {
    value: string;
    preserve?: boolean;
}

export interface TemplateeMap {
    html: ObjectMap<PlainObject>;
    js: ObjectMap<PlainObject>;
    css: ObjectMap<PlainObject>;
}