import type { XmlNodeTag as IXmlNodeTag, TagAppend, TagIndex } from '../../types/lib/squared';

import type { Element, Node } from 'domhandler';

export interface ParserResult extends Partial<TagIndex> {
    element: Null<Node>;
    error: Null<Error>;
}

export type WriteResult = [string, string, Null<Error>?];
export type SaveResult = [string, Null<Error>?];

export interface XmlNodeTag extends IXmlNodeTag {
    startIndex?: number;
    endIndex?: number;
}

export interface FindElementOptions {
    document?: string;
    byId?: boolean;
}

export interface WriteOptions {
    remove?: boolean;
    rename?: boolean;
    append?: XmlNodeTag;
    prepend?: XmlNodeTag;
}

export interface IXmlWriter {
    documentName: string;
    source: string;
    elements: XmlNodeTag[];
    readonly newline: string;
    readonly rootName?: string;
    init(): void;
    newElement(node: XmlNodeTag): IXmlElement;
    insertElement(node: XmlNodeTag, data: TagAppend): [IXmlElement, string];
    append(node: XmlNodeTag): Null<IXmlElement>;
    prepend(node: XmlNodeTag): Null<IXmlElement>;
    write(element: IXmlElement, options?: WriteOptions): boolean;
    close(): string;
    update(node: XmlNodeTag, outerXml: string): void;
    updateByTag(element: Required<TagIndex>, outerXml: string, startIndex: number, endIndex: number): boolean;
    increment(node: XmlNodeTag): void;
    decrement(node: XmlNodeTag): XmlNodeTag[];
    renameTag(node: XmlNodeTag, tagName: string): void;
    indexTag(tagName: string, append?: boolean): boolean;
    setRawString(sourceXml: string, outerXml: string): boolean;
    getRawString(startIndex: number, endIndex: number): string;
    spliceRawString(outerXml: string, startIndex: number, endIndex: number): string;
    hasErrors(): boolean;
}

export interface XmlWriterConstructor {
    escapeXmlString(value: string): string;
    getAttrId(document: string): string;
    new(documentName: string, source: string, elements: XmlNodeTag[]): IXmlWriter;
}

export interface IXmlElement {
    tagName: string;
    innerXml: string;
    newline: string;
    lowerCase: boolean;
    readonly documentName: string;
    readonly node: XmlNodeTag;
    readonly outerXml: string;
    readonly modified: boolean;
    setAttribute(name: string, value: string): void;
    getAttribute(name: string): Optional<string>;
    removeAttribute(...names: string[]): void;
    hasAttribute(name: string): boolean;
    write(source: string, options?: WriteOptions): WriteResult;
    save(source: string, options?: WriteOptions): SaveResult;
    findIndexOf(source: string, append?: boolean): [number, number, Null<Error>?];
}

export interface XmlElementConstructor {
    hasInnerXml(tagName: string): boolean;
    findCloseTag(source: string, startIndex?: number): number;
    splitOuterXml(outerXml: string, startIndex?: number): [string, string, string];
    getNewlineString(leading: string, trailing: string, newline?: string): string;
    new(documentName: string, node: XmlNodeTag, attributes?: StandardMap): IXmlElement;
}

export interface IDomWriter {
    documentElement: Null<XmlNodeTag>;
    replaceAll(predicate: (elem: Element) => boolean, callback: (elem: Element, source: string) => Undef<string>): number;
}

export interface DomWriterConstructor {
    readonly TAG_VOID: string[];
    normalize(source: string): string;
    getDocumentElement(source: string): ParserResult;
    findElement(source: string, node: XmlNodeTag, options?: FindElementOptions): ParserResult;
    new(documentName: string, source: string, elements: XmlNodeTag[], normalize?: boolean): IDomWriter;
}