import type { XmlTagNode as IXmlTagNode, TagAppend, TagData } from '../../types/lib/squared';

import type { Element, Node } from 'domhandler';

export interface SourceIndex {
    startIndex: number;
    endIndex: number;
}

export interface SourceContent extends SourceIndex, Partial<TagData> {
    outerXml: string;
}

export interface XmlTagNode extends IXmlTagNode, Partial<SourceIndex> {}

export interface WriteOptions {
    remove?: boolean;
    rename?: boolean;
    append?: TagAppend;
}

export type AttributeMap = Map<string, Optional<string>>;
export type AttributeList = [string, Optional<string>][];
export type WriteResult = [string, string, Null<Error>?];
export type SaveResult = [string, Null<Error>?];

export interface FindElementOptions {
    document?: string;
    id?: string;
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
    increment(node: XmlTagNode): void;
    decrement(node: XmlTagNode): XmlTagNode[];
    renameTag(node: XmlTagNode, tagName: string): void;
    indexTag(tagName: string, append?: boolean): boolean;
    resetTag(tagName: string): void;
    getOuterXmlById(id: string, caseSensitive?: boolean): Undef<Required<SourceContent>>;
    setRawString(targetXml: string, outerXml: string): boolean;
    getRawString(index: SourceIndex): string;
    spliceRawString(content: SourceContent): string;
    hasErrors(): boolean;
    get newId(): string;
}

export interface XmlWriterConstructor {
    getNodeId(node: XmlTagNode, document: string): string;
    escapeXmlString(value: string): string;
    findCloseTag(source: string, startIndex?: number): number;
    getNewlineString(leading: string, trailing: string, newline?: string): string;
    new(documentName: string, source: string, elements: XmlTagNode[]): IXmlWriter;
}

export class IXmlElement extends IXmlBase {
    tagVoid: boolean;
    readonly node: XmlTagNode;
    parseOuterXml(outerXml?: string): [string, string];
    setAttribute(name: string, value: string): void;
    getAttribute(name: string): Optional<string>;
    removeAttribute(...names: string[]): void;
    hasAttribute(name: string): boolean;
    write(source: string, options?: WriteOptions): WriteResult;
    save(source: string, options?: WriteOptions): SaveResult;
    findIndexOf(source: string): Undef<SourceIndex>;
    set id(value: string);
    get id(): string;
    set tagName(value: string);
    get tagName(): string;
    set innerXml(value: string);
    get innerXml(): string
    get outerXml(): string;
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