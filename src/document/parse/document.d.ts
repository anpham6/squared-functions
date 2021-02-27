import type { XmlTagNode as IXmlTagNode, TagAppend, TagData } from '../../types/lib/squared';

import type { Element, Node } from 'domhandler';

export interface SourceIndex {
    startIndex: number;
    endIndex: number;
}

export interface SourceContent extends SourceIndex {
    outerXml: string;
}

export interface SourceTagNode extends SourceContent, TagData {
    lowerCase?: boolean;
}

export interface XmlTagNode extends IXmlTagNode, Partial<SourceIndex> {}

export interface WriteOptions {
    append?: TagAppend;
}

export interface ReplaceOptions extends WriteOptions, SourceIndex {
    remove?: boolean;
}

export type AttributeMap = Map<string, Optional<string>>;
export type AttributeList = [string, Optional<string>][];
export type TagOffsetMap = ObjectMap<Undef<number>>;
export type WriteResult = [string, string, Null<Error>?];
export type SaveResult = [string, Null<Error>?];

export interface FindElementOptions {
    document?: string;
    id?: string;
}

export interface OuterXmlByIdOptions {
    tagName?: string;
    tagVoid?: boolean;
}

export interface ParserResult extends Partial<TagData> {
    element: Null<Node>;
    error: Null<Error>;
}

export class IXmlBase {
    newline: string;
    readonly documentName: string;
    write(...args: unknown[]): unknown;
    save(...args: unknown[]): unknown;
    reset(): void;
    get nameOfId(): string;
    get modified(): boolean;
}

export class IXmlWriter extends IXmlBase {
    source: string;
    elements: XmlTagNode[];
    readonly rootName?: string;
    init(): void;
    insertNodes(nodes?: XmlTagNode[]): void;
    fromNode(node: XmlTagNode, append?: TagAppend): IXmlElement;
    newElement(node: XmlTagNode): IXmlElement;
    append(node: XmlTagNode, prepend?: boolean): Null<IXmlElement>;
    write(element: IXmlElement, options?: WriteOptions): boolean;
    save(): string;
    close(): string;
    update(node: XmlTagNode, outerXml: string): void;
    increment(node: XmlTagNode, offset?: number): void;
    decrement(node: XmlTagNode): XmlTagNode[];
    renameTag(node: XmlTagNode, tagName: string): Null<Error>;
    indexTag(tagName: string, append?: TagAppend, offset?: number): Null<Error>;
    resetTag(tagName: string): void;
    resetPosition(startIndex?: number): void;
    getOuterXmlById(id: string, caseSensitive?: boolean, options?: OuterXmlByIdOptions): Undef<SourceTagNode>;
    setRawString(targetXml: string, outerXml: string): string;
    getRawString(index: SourceIndex): string;
    spliceRawString(content: SourceContent, reset?: boolean): string;
    hasErrors(): boolean;
    get newId(): string;
}

export interface XmlWriterConstructor {
    PATTERN_TAGOPEN: string;
    PATTERN_ATTRNAME: string;
    PATTERN_ATTRVALUE: string;
    PATTERN_TRAILINGSPACE: string;
    escapeXmlString(value: string): string;
    getNewlineString(leading: string, trailing: string, newline?: string): string;
    findCloseTag(source: string, startIndex?: number): number;
    getTagOffset(source: string, sourceNext?: string): ObjectMap<number>;
    getNodeId(node: XmlTagNode, document: string): string;
    new(documentName: string, source: string, elements: XmlTagNode[]): IXmlWriter;
}

export class IXmlElement extends IXmlBase {
    tagVoid: boolean;
    readonly node: XmlTagNode;
    readonly TAG_VOID: string[];
    parseOuterXml(outerXml?: string): [string, string];
    getTagOffset(nextXml?: string): Null<TagOffsetMap>;
    setAttribute(name: string, value: string): void;
    getAttribute(name: string): Optional<string>;
    removeAttribute(...names: string[]): void;
    hasAttribute(name: string): boolean;
    write(source: string, options?: WriteOptions): WriteResult;
    replace(source: string, options: ReplaceOptions): WriteResult;
    save(source: string, options?: WriteOptions): SaveResult;
    findIndexOf(source: string): Undef<SourceIndex>;
    hasPosition(): boolean;
    set id(value: string);
    get id(): string;
    set tagName(value: string);
    get tagName(): string;
    set innerXml(value: string);
    get innerXml(): string
    get outerXml(): string;
    set remove(value);
    get remove(): boolean;
    set tagOffset(value: Null<TagOffsetMap>);
    get tagOffset(): Null<TagOffsetMap>;
}

export interface XmlElementConstructor {
    writeAttributes(attrs: AttributeMap | AttributeList, escapeEntities?: boolean): string;
    new(documentName: string, node: XmlTagNode, attributes?: StandardMap, tagVoid?: boolean): IXmlElement;
}

export class IDomWriter extends IXmlWriter {
    documentElement: Null<XmlTagNode>;
    replaceAll(predicate: (elem: Element) => boolean, callback: (elem: Element, source: string) => Undef<string>): number;
}

export interface DomWriterConstructor {
    hasInnerXml(tagName: string): boolean;
    normalize(source: string): string;
    getDocumentElement(source: string): ParserResult;
    findElement(source: string, node: XmlTagNode, options?: FindElementOptions): ParserResult;
    new(documentName: string, source: string, elements: XmlTagNode[], normalize?: boolean): IDomWriter;
}