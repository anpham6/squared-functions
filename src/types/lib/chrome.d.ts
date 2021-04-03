/// <reference path="type.d.ts" />

import type { AttributeMap, ElementAction, DataSource as IDataSource, ViewEngine } from './squared';

import type { FilterQuery } from 'mongodb';

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
    usedVariables?: string[];
    unusedStyles?: string[];
    productionRelease?: boolean | string;
}

export interface DataSource extends IDataSource {
    source: "uri" | "cloud" | "mongodb";
    type: "text" | "attribute" | "display";
    value?: StringOfArray | ObjectMap<unknown>;
    viewEngine?: ViewEngine | string;
}

export interface DBDataSource<T = string | PlainObject | unknown[]> extends DataSource {
    source: "cloud" | "mongodb";
    name?: string;
    table?: string;
    query?: T;
    options?: PlainObject;
    value?: string | ObjectMap<StringOfArray>;
}

export interface UriDataSource extends DataSource {
    source: "uri";
    uri: string;
    format?: string;
    query?: string;
}

export interface MongoDataSource extends DBDataSource<FilterQuery<unknown>> {
    source: "mongodb";
    uri?: string;
    credential?: string | StandardMap;
}