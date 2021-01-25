import type { ElementIndex, TagIndex } from '../../types/lib/squared';

import type { Element, Node } from 'domhandler';

export interface WriteOptions {
    remove?: boolean;
    rename?: boolean;
}

export interface IDomWriter {
    documentName: string;
    source: string;
    elements: ElementIndex[];
    documentElement: Null<ElementIndex>;
    write(element: IHtmlElement, options?: WriteOptions): boolean;
    update(index: TagIndex, replaceHTML: string): void;
    decrement(index: ElementIndex): ElementIndex[];
    renameTag(index: ElementIndex, tagName: string): void;
    indexTag(tagName: string): void;
    replaceAll(predicate: (elem: Element) => boolean, callback: (elem: Element, source: string) => Undef<string>): number;
    setRawString(segmentHTML: string, replaceHTML: string): boolean;
    getRawString(startIndex: number, endIndex: number): string;
    getDocumentElement(source: string): Null<Node>;
    hasErrors(): boolean;
}

export interface DomWriterConstructor {
    normalize(source: string): string;
    getNewlineString(leading: string, trailing: string): string;
    new(documentName: string, source: string, elements: ElementIndex[], normalize?: boolean): IDomWriter;
}

export interface IHtmlElement {
    documentName: string;
    tagName: string;
    innerHTML: string;
    readonly index: ElementIndex;
    readonly outerHTML: string;
    setAttribute(name: string, value: string): void;
    getAttribute(name: string): Optional<string>;
    removeAttribute(...names: string[]): void;
    hasAttribute(name: string): boolean;
    write(source: string, remove?: boolean): [string, string, Error?];
}

export class HtmlElementConstructor {
    hasInnerHTML(tagName: string): boolean;
    splitOuterHTML(outerHTML: string, startIndex?: number): [string, string, string];
    new(documentName: string, index: ElementIndex, attributes?: StandardMap): IHtmlElement;
}