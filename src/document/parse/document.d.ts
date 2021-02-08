import type { XmlNodeTag as IXmlNodeTag, TagAppend, TagData } from '../../types/lib/squared';

import type { Element, Node } from 'domhandler';

export interface SourceIndex {
    startIndex: number;
    endIndex: number;
}

export interface SourceContent extends SourceIndex {
    outerXml: string;
    tagName?: string;
}

export interface XmlNodeTag extends IXmlNodeTag, Partial<SourceIndex> {
    id?: StringMap;
}

export interface WriteOptions {
    remove?: boolean;
    rename?: boolean;
    append?: TagAppend;
}

export type AttributeMap = Map<string, Optional<string>>;
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

export class IXmlWriter {
    documentName: string;
    source: string;
    elements: XmlNodeTag[];
    readonly newline: string;
    readonly rootName?: string;
    init(): void;
    insertNodes(nodes?: XmlNodeTag[]): void;
    fromNode(node: XmlNodeTag, append?: TagAppend): IXmlElement;
    newElement(node: XmlNodeTag): IXmlElement;
    append(node: XmlNodeTag, prepend?: boolean): Null<IXmlElement>;
    write(element: IXmlElement, options?: WriteOptions): boolean;
    save(): string;
    close(): string;
    update(node: XmlNodeTag, outerXml: string): void;
    increment(node: XmlNodeTag): void;
    decrement(node: XmlNodeTag): XmlNodeTag[];
    renameTag(node: XmlNodeTag, tagName: string): void;
    indexTag(tagName: string, append?: boolean): boolean;
    resetTag(tagName: string): void;
    getOuterXmlById(id: string, caseSensitive?: boolean): Undef<Required<SourceContent>>;
    setRawString(targetXml: string, outerXml: string): boolean;
    getRawString(index: SourceIndex): string;
    spliceRawString(content: SourceContent): string;
    hasErrors(): boolean;
    get newId(): string;
    get nameOfId(): string;
    get modified(): boolean;
}

export interface XmlWriterConstructor {
    getNodeId(node: XmlNodeTag, document: string): string;
    escapeXmlString(value: string): string;
    findCloseTag(source: string, startIndex?: number): number;
    getNewlineString(leading: string, trailing: string, newline?: string): string;
    new(documentName: string, source: string, elements: XmlNodeTag[]): IXmlWriter;
}

export class IXmlElement {
    newline: string;
    tagVoid: boolean;
    readonly documentName: string;
    readonly node: XmlNodeTag;
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
    get modified(): boolean;
}

export interface XmlElementConstructor {
    new(documentName: string, node: XmlNodeTag, attributes?: StandardMap, tagVoid?: boolean): IXmlElement;
}

export class IDomWriter extends IXmlWriter {
    documentElement: Null<XmlNodeTag>;
    replaceAll(predicate: (elem: Element) => boolean, callback: (elem: Element, source: string) => Undef<string>): number;
}

export interface DomWriterConstructor {
    hasInnerXml(tagName: string): boolean;
    normalize(source: string): string;
    getDocumentElement(source: string): ParserResult;
    findElement(source: string, node: XmlNodeTag, options?: FindElementOptions): ParserResult;
    new(documentName: string, source: string, elements: XmlNodeTag[], normalize?: boolean): IDomWriter;
}