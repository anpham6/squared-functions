import type { AttributeMap, ElementAction, DataSource as IDataSource, ViewEngine } from './squared';

import type { FilterQuery, MongoClientOptions } from 'mongodb';

export type UnusedStyles = string[];

export interface ChromeAsset extends ElementAction {
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

export interface RequestData extends DocumentOutput, ICssRuleData {
    baseUrl?: string;
    templateMap?: TemplateMap;
}

export interface DocumentOutput {
    productionRelease?: boolean | string;
    normalizeHtmlOutput?: boolean;
    imports?: StringMap;
}

export interface ICssRuleData {
    usedVariables?: string[];
    usedFontFace?: string[];
    usedKeyframes?: string[];
    unusedStyles?: string[];
    unusedMedia?: string[];
    unusedSupports?: string[];
}

export interface DataSource extends IDataSource, ElementAction {
    source: "uri" | "cloud" | "mongodb";
    type: "text" | "attribute" | "display";
    value?: StringOfArray | ObjectMap<unknown>;
    viewEngine?: ViewEngine | string;
}

export interface DBDataSource<T = string | PlainObject | unknown[], U = PlainObject> extends DataSource {
    source: "cloud" | "mongodb";
    name?: string;
    table?: string;
    query?: T;
    options?: U;
    value?: string | ObjectMap<StringOfArray>;
}

export interface UriDataSource extends DataSource {
    source: "uri";
    uri: string;
    format?: string;
    query?: string;
}

export interface MongoDataSource extends DBDataSource<FilterQuery<unknown>, MongoClientOptions> {
    source: "mongodb";
    uri?: string;
    credential?: string | StandardMap;
}