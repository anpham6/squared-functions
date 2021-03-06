import type { XmlTagNode as IXmlTagNode, TagAppend, TagData } from '../../types/lib/squared';

import type { Node } from 'domhandler';

export interface SourceIndex {
    startIndex: number;
    endIndex: number;
}

export interface SourceContent extends SourceIndex {
    outerXml: string;
    type?: string;
}

export interface SourceTagNode extends SourceContent, TagData {
    id?: string;
    ignoreCase?: boolean;
}

export interface XmlTagNode extends IXmlTagNode, Partial<SourceIndex> {}

export interface ReplaceOptions extends SourceIndex {
    append?: TagAppend;
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

export interface TagNodeOptions {
    tagVoid?: boolean;
}

export interface TagNodeByIdOptions extends TagNodeOptions {
    tagName?: string;
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
    get patternId(): RegExp;
    get modified(): boolean;
}

export class IXmlWriter extends IXmlBase {
    source: string;
    elements: XmlTagNode[];
    readonly rootName?: string;
    readonly ignoreTagName?: string;
    readonly ignoreCaseTagName?: boolean;
    init(offsetMap?: TagOffsetMap): void;
    getInvalidArea(): Undef<SourceContent[]>;
    insertNodes(nodes?: XmlTagNode[]): void;
    fromNode(node: XmlTagNode, append?: TagAppend): IXmlElement;
    newElement(node: XmlTagNode): IXmlElement;
    append(node: XmlTagNode): Null<IXmlElement>;
    write(element: IXmlElement): boolean;
    save(): string;
    close(): string;
    update(node: XmlTagNode, outerXml: string, append?: TagAppend, offsetMap?: Null<TagOffsetMap>): void;
    increment(nodes: XmlTagNode[], offset?: number): void;
    decrement(node: XmlTagNode, offset?: number, remove?: boolean): XmlTagNode[];
    renameTag(node: XmlTagNode, tagName: string): void;
    indexTag(tagName: string, append?: TagAppend, offset?: number): void;
    resetTag(tagName: string): void;
    resetPosition(startIndex?: number): void;
    getElementById(id: string, ignoreCase?: boolean, options?: TagNodeByIdOptions): Undef<SourceTagNode>;
    getElementsByTagName(tagName: string, ignoreCase?: boolean, options?: TagNodeOptions): SourceTagNode[];
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
    escapeXmlString(value: string, ampersand?: boolean): string;
    getNewlineString(leading: string, trailing: string, newline?: string): string;
    findCloseTag(source: string, startIndex?: number): number;
    getTagOffset(source: string, sourceNext?: string): TagOffsetMap;
    getNodeId(node: XmlTagNode, document: string): string;
    getNameOfId(document: string): string;
    getCommentsAndCDATA(source: string, nodePattern?: string, ignoreCase?: boolean): SourceContent[];
    isIndex(value: unknown): boolean;
    isCount(value: unknown): boolean;
    isSpace(ch: string): boolean;
    new(documentName: string, source: string, elements: XmlTagNode[]): IXmlWriter;
}

export class IXmlElement extends IXmlBase {
    TAG_VOID: string[];
    readonly node: XmlTagNode;
    setAppend(value?: TagAppend): void;
    parseOuterXml(outerXml?: string, tagVoid?: boolean): [string, string, boolean];
    getTagOffset(nextXml?: string): Undef<TagOffsetMap>;
    setAttribute(name: string, value: string): void;
    getAttribute(name: string): Optional<string>;
    removeAttribute(...names: string[]): void;
    hasAttribute(name: string): boolean;
    hasModifiedContent(): boolean;
    write(source: string, invalid?: SourceIndex[]): WriteResult;
    save(source: string, invalid?: SourceIndex[]): SaveResult;
    replace(source: string, options: ReplaceOptions): WriteResult;
    findIndexOf(source: string): Undef<SourceIndex>;
    getOuterContent(): [string, AttributeList, string];
    getInnerOffset(tagName: string): number;
    hasPosition(): boolean;
    set id(value: string);
    get id(): string;
    set tagName(value: string);
    get tagName(): string;
    get tagVoid(): boolean;
    set innerXml(value: string);
    get innerXml(): string
    get outerXml(): string;
    set remove(value);
    get remove(): boolean;
    get append(): Undef<TagAppend>;
    set tagOffset(value: Undef<TagOffsetMap>);
    get tagOffset(): Undef<TagOffsetMap>;
}

export interface XmlElementConstructor {
    writeAttributes(attrs: AttributeMap | AttributeList, escapeEntities?: boolean): string;
    new(documentName: string, node: XmlTagNode, attributes?: StandardMap, tagVoid?: boolean): IXmlElement;
}

export class IDomWriter extends IXmlWriter {
    documentElement: Null<XmlTagNode>;
}

export interface DomWriterConstructor {
    hasInnerXml(tagName: string): boolean;
    normalize(source: string): string;
    getDocumentElement(source: string): ParserResult;
    findElement(source: string, node: XmlTagNode, options?: FindElementOptions): ParserResult;
    new(documentName: string, source: string, elements: XmlTagNode[], normalize?: boolean): IDomWriter;
}