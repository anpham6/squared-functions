/// <reference path="type.d.ts" />

import type { AttributeMap, ElementAction, DataSource as IDataSource, ViewEngine } from './squared';

interface DataSourceAction {
    type: "text" | "attribute";
}

interface TemplateAction extends DataSourceAction {
    viewEngine?: ViewEngine | string;
    value?: string | ObjectMap<unknown>;
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
    productionRelease?: boolean;
}

export interface DataSource extends IDataSource, DataSourceAction, TemplateAction {}

export interface UriDataSource extends DataSource, TemplateAction {
    format: string;
    uri: string;
    query?: string;
}

export interface CloudDataSource extends DataSource, TemplateAction, PlainObject {}