import type { ElementIndex as IElementIndex, TagIndex } from '../../types/lib/squared';

import type { Element, Node } from 'domhandler';

export interface ParserResult extends Partial<TagIndex> {
    element: Null<Node>;
    error: Null<Error>;
}

export interface ElementIndex extends IElementIndex {
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
    append?: ElementIndex;
}

export interface IDomWriter {
    documentName: string;
    source: string;
    elements: ElementIndex[];
    documentElement: Null<ElementIndex>;
    readonly newline: string;
    append(index: ElementIndex): Null<IHtmlElement>;
    write(element: IHtmlElement, options?: WriteOptions): boolean;
    close(): string;
    update(element: ElementIndex, replaceHTML: string): void;
    updateByTag(element: Required<TagIndex>, replaceHTML: string): boolean;
    increment(element: ElementIndex): void;
    decrement(element: ElementIndex): ElementIndex[];
    renameTag(element: ElementIndex, tagName: string): void;
    indexTag(tagName: string, append?: boolean): boolean;
    replaceAll(predicate: (elem: Element) => boolean, callback: (elem: Element, source: string) => Undef<string>): number;
    setRawString(sourceHTML: string, replaceHTML: string): boolean;
    getRawString(startIndex: number, endIndex: number): string;
    spliceRawString(startIndex: number, endIndex: number, replaceHTML: string): string;
    hasErrors(): boolean;
}

export interface DomWriterConstructor {
    normalize(source: string): string;
    getDocumentElement(source: string): ParserResult;
    findElement(source: string, index: ElementIndex, options?: FindElementOptions): ParserResult;
    getNewlineString(leading: string, trailing: string, newline?: string): string;
    new(documentName: string, source: string, elements: ElementIndex[], normalize?: boolean): IDomWriter;
}

export interface IHtmlElement {
    documentName: string;
    tagName: string;
    innerHTML: string;
    newline: string;
    readonly index: ElementIndex;
    readonly outerHTML: string;
    readonly modified: boolean;
    setAttribute(name: string, value: string): void;
    getAttribute(name: string): Optional<string>;
    removeAttribute(...names: string[]): void;
    hasAttribute(name: string): boolean;
    write(source: string, options?: WriteOptions): [string, string, Null<Error>?];
    save(source: string, options?: WriteOptions): [string, Null<Error>?];
}

export interface HtmlElementConstructor {
    hasInnerHTML(tagName: string): boolean;
    findCloseTag(source: string, startIndex?: number): number;
    splitOuterHTML(outerHTML: string, startIndex?: number): [string, string, string];
    new(documentName: string, index: ElementIndex, attributes?: StandardMap): IHtmlElement;
}