import type { XmlNodeTag as IXmlNodeTag, TagAppend, TagIndex } from '../../types/lib/squared';

import type { Element, Node } from 'domhandler';

export interface SourceIndex {
    startIndex: number;
    endIndex: number;
}

export interface SourceContent extends SourceIndex {
    outerXml: string;
}

export interface XmlNodeTag extends IXmlNodeTag, Partial<SourceIndex> {}

export interface WriteOptions {
    remove?: boolean;
    rename?: boolean;
    append?: TagAppend;
    prepend?: TagAppend;
}

export type AttributeMap = Map<string, Optional<string>>;
export type WriteResult = [string, string, Null<Error>?];
export type SaveResult = [string, Null<Error>?];
export type FindIndexOfResult = [number, number, Null<Error>?];

export interface IXmlWriter {
    documentName: string;
    source: string;
    elements: XmlNodeTag[];
    readonly newline: string;
    readonly modified: boolean;
    readonly rootName?: string;
    insertNodes(nodes?: XmlNodeTag[]): void;
    fromNode(node: XmlNodeTag, append?: TagAppend): IXmlElement;
    newElement(node: XmlNodeTag): IXmlElement;
    append(node: XmlNodeTag): Null<IXmlElement>;
    prepend(node: XmlNodeTag): Null<IXmlElement>;
    write(element: IXmlElement, options?: WriteOptions): boolean;
    save(): string;
    close(): string;
    update(node: XmlNodeTag, outerXml: string): void;
    updateByTag(element: Required<TagIndex>, content: SourceContent): boolean;
    increment(node: XmlNodeTag): void;
    decrement(node: XmlNodeTag): XmlNodeTag[];
    renameTag(node: XmlNodeTag, tagName: string): void;
    indexTag(tagName: string, append?: boolean): boolean;
    setRawString(targetXml: string, outerXml: string): boolean;
    getRawString(index: SourceIndex): string;
    spliceRawString(content: SourceContent): string;
    hasErrors(): boolean;
}

export interface XmlWriterConstructor {
    escapeXmlString(value: string): string;
    new(documentName: string, source: string, elements: XmlNodeTag[]): IXmlWriter;
}

export interface IXmlElement {
    tagName: string;
    id: string;
    innerXml: string;
    newline: string;
    lowerCase: boolean;
    readonly documentName: string;
    readonly node: XmlNodeTag;
    readonly outerXml: string;
    readonly modified: boolean;
    readonly tagVoid: boolean;
    splitOuterXml(tagName: string, outerXml: string): [string, string];
    setAttribute(name: string, value: string): void;
    getAttribute(name: string): Optional<string>;
    removeAttribute(...names: string[]): void;
    hasAttribute(name: string): boolean;
    write(source: string, options?: WriteOptions): WriteResult;
    save(source: string, options?: WriteOptions): SaveResult;
    findIndexOf(source: string): FindIndexOfResult;
}

export interface XmlElementConstructor {
    findCloseTag(source: string, startIndex?: number): number;
    getNewlineString(leading: string, trailing: string, newline?: string): string;
    new(documentName: string, node: XmlNodeTag, attributes?: StandardMap, TAG_VOID?: string[]): IXmlElement;
}

export interface FindElementOptions {
    document?: string;
    id?: string;
}

export interface ParserResult extends Partial<TagIndex> {
    element: Null<Node>;
    error: Null<Error>;
}

export interface IDomWriter {
    documentElement: Null<XmlNodeTag>;
    replaceAll(predicate: (elem: Element) => boolean, callback: (elem: Element, source: string) => Undef<string>): number;
}

export interface DomWriterConstructor {
    readonly TAG_VOID: string[];
    hasInnerXml(tagName: string): boolean;
    normalize(source: string): string;
    getDocumentElement(source: string): ParserResult;
    findElement(source: string, node: XmlNodeTag, options?: FindElementOptions): ParserResult;
    new(documentName: string, source: string, elements: XmlNodeTag[], normalize?: boolean): IDomWriter;
}