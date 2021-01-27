import type { ElementIndex, TagIndex } from '../../types/lib/squared';

import type { Element, Node } from 'domhandler';

export type ParserResult = [Null<Node>, Null<Error>];

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
    update(index: ElementIndex, replaceHTML: string): void;
    updateByTag(index: TagIndex, replaceHTML: string): boolean;
    decrement(index: ElementIndex): ElementIndex[];
    renameTag(index: ElementIndex, tagName: string): void;
    indexTag(tagName: string): void;
    replaceAll(predicate: (elem: Element) => boolean, callback: (elem: Element, source: string) => Undef<string>): number;
    setRawString(segmentHTML: string, replaceHTML: string): boolean;
    getRawString(startIndex: number, endIndex: number): string;
    hasErrors(): boolean;
}

export interface DomWriterConstructor {
    normalize(source: string): string;
    getDocumentElement(source: string): ParserResult;
    findElement(source: string, index: ElementIndex, documentName?: string): ParserResult;
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
    save(source: string, remove?: boolean): [string, Null<Error>?];
}

export class HtmlElementConstructor {
    hasInnerHTML(tagName: string): boolean;
    findCloseTag(source: string, startIndex?: number): number;
    splitOuterHTML(outerHTML: string, startIndex?: number): [string, string, string];
    new(documentName: string, index: ElementIndex, attributes?: StandardMap): IHtmlElement;
}