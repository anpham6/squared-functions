/// <reference path="type.d.ts" />

import type { AttributeMap, ElementAction, DataSource as IDataSource, ViewEngine } from './squared';

import type { FilterQuery } from 'mongodb';

interface TemplateAction {
    type: "text" | "attribute";
    value?: string | ObjectMap<unknown>;
    viewEngine?: ViewEngine | string;
}

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
    productionRelease?: boolean | string;
}

export interface DataSource extends IDataSource, TemplateAction, PlainObject {
    source: "uri" | "cloud" | "mongodb";
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
    format: string;
    uri: string;
    query?: string;
}

export interface MongoDataSource extends DBDataSource<FilterQuery<unknown>> {
    source: "mongodb";
    uri?: string;
}