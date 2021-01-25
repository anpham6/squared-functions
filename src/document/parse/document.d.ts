import type { ElementIndex } from '../../types/lib/squared';

import type { Element, Node } from 'domhandler';

export interface WriteOptions {
    remove?: boolean;
    rename?: boolean;
}

export interface RebuildOptions {
    nodes: Element[];
    sourceIndex: number;
}

export interface IDomWriter {
    source: string;
    elements: ElementIndex[];
    documentElement: Null<ElementIndex>;
    write(element: IHtmlElement, options?: WriteOptions): boolean;
    rebuild(index: ElementIndex, replaceHTML: string, options?: RebuildOptions | true): void;
    decrement(index: ElementIndex): ElementIndex[];
    renameTag(index: ElementIndex, tagName: string): boolean;
    insertTag(tagName: string, revised?: ElementIndex[]): boolean;
    findTagIndex(element: Element, dom: Node[], replaceHTML?: string): number;
    setRawString(segmentHTML: string, replaceHTML: string): boolean;
    getRawString(startIndex: number, endIndex: number): string;
    getDocumentElement(source: string): Null<Node>;
    hasErrors(): boolean;
}

export interface DomWriterConstructor {
    normalize(source: string): string;
    minifySpace(value: string): string;
    getNewlineString(leading: string, trailing: string): string;
    new(source: string, elements: ElementIndex[], normalize?: boolean): IDomWriter;
}

export interface IHtmlElement {
    position: ElementIndex;
    attributes: StandardMap;
    tagName: string;
    innerHTML: string;
    readonly outerHTML: string;
    setAttribute(name: string, value: string): void;
    getAttribute(name: string): Undef<string>;
    removeAttribute(...names: string[]): void;
    hasAttribute(name: string): boolean;
    write(source: string, remove?: boolean): [string, string, Error?];
}

export class HtmlElementConstructor {
    hasInnerHTML(tagName: string): boolean;
    splitOuterHTML(outerHTML: string, startIndex?: number): [string, string, string];
    new(position: ElementIndex, attributes?: StandardMap): IHtmlElement;
}