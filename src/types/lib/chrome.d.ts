/// <reference path="type.d.ts" />

import type { AttributeMap, ElementAction } from './squared';

export type UnusedStyles = string[];

export interface ChromeAsset extends ElementAction {
    format?: string;
    preserve?: boolean;
    exclude?: boolean;
    inlineContent?: string;
    attributes?: AttributeMap;
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