import type { ElementIndex, TagIndex } from '../../types/lib/squared';

import type { IDomWriter, IHtmlElement, ParserResult, WriteOptions } from './document';

import escapeRegexp = require('escape-string-regexp');
import uuid = require('uuid');

import htmlparser2 = require('htmlparser2');
import domhandler = require('domhandler');
import domutils = require('domutils');

const Parser = htmlparser2.Parser;
const DomHandler = domhandler.DomHandler;

const SELF_CLOSING = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

function isSpace(ch: string) {
    const n = ch.charCodeAt(0);
    return n === 32 || n < 14 && n > 8;
}

function applyAttributes(attrs: Map<string, Optional<string>>, data: Undef<StandardMap>) {
    if (data) {
        for (const key in data) {
            attrs.set(key.toLowerCase(), data[key]);
        }
    }
}

export class DomWriter implements IDomWriter {
    public static normalize(source: string) {
        const pattern = /(?:<(\s*)((?:"[^"]*"|'[^']*'|[^"'>])+?)(\s*\/?\s*)>|<(\s*)\/([^>]+?)(\s*)>)/g;
        let match: Null<RegExpExecArray>;
        while (match = pattern.exec(source)) {
            let value: Undef<string>;
            if (match[2]) {
                if (match[1] || match[3]) {
                    value = '<' + match[2] + '>';
                }
            }
            else if (match[4] || match[6]) {
                value = '</' + match[5] + '>';
            }
            if (value) {
                source = source.substring(0, match.index) + value + source.substring(match.index + match[0].length);
                pattern.lastIndex -= match[0].length - value.length;
            }
        }
        return source;
    }

    public static getDocumentElement(source: string): ParserResult {
        let result: Null<domhandler.Node> = null,
            error: Null<Error> = null;
        new Parser(new DomHandler((err, dom) => {
            if (!err) {
                result = domutils.findOne(elem => elem.tagName === 'html', dom);
            }
            else {
                error = err;
            }
        }, { withStartIndices: true, withEndIndices: true })).end(source);
        return [result, error];
    }

    public static findElement(source: string, index: ElementIndex, documentName?: string): ParserResult {
        let result: Null<domhandler.Node> = null,
            error: Null<Error> = null;
        new Parser(new DomHandler((err, dom) => {
            if (!err) {
                if (documentName) {
                    const id = index.id[documentName];
                    if (id) {
                        const documentId = `data-${documentName}-id`;
                        result = domutils.findOne(elem => elem.attribs[documentId] === id, dom);
                        if (result) {
                            return;
                        }
                    }
                }
                const nodes = domutils.getElementsByTagName(index.tagName, dom, true);
                if (nodes.length === index.tagCount) {
                    result = nodes[index.tagIndex] as domhandler.Node;
                }
            }
            else {
                error = err;
            }
        }, { withStartIndices: true, withEndIndices: true })).end(source);
        return [result, error];
    }

    public static getNewlineString(leading: string, trailing: string) {
        return leading.includes('\n') || /(?:\r?\n){2,}$/.test(trailing) ? (leading + trailing).includes('\r') ? '\r\n' : '\n' : '';
    }

    public source: string;
    public modifyCount = 0;
    public failCount = 0;
    public errors: Error[] = [];
    public documentElement: Null<ElementIndex> = null;
    public newline = '\n';

    constructor(public documentName: string, source: string, public elements: ElementIndex[], normalize = true) {
        const items: ElementIndex[] = [];
        const appending: Required<ElementIndex>[] = [];
        for (let i = 0; i < elements.length; ++i) {
            const item = elements[i];
            item.tagName = item.tagName.toLowerCase();
            if (item.tagName === 'html') {
                items.push(item);
            }
            else if (item.appendOrder !== undefined && item.domIndex > 0 && item.tagName) {
                if (item.appendName) {
                    item.appendName = item.appendName.toLowerCase();
                }
                appending.push(item as Required<ElementIndex>);
            }
            else if (item.tagIndex < 0 || item.tagCount < 1 || item.domIndex < 0) {
                elements.slice(i--, 1);
            }
        }
        const documentElement = items.find(item => item.innerHTML);
        const html = /<\s*html[\s|>]/i.exec(source);
        if (source.includes('\r\n')) {
            this.newline = '\r\n';
        }
        let outerHTML = '',
            startIndex = -1;
        if (html) {
            const opening = HtmlElement.splitOuterHTML('html', source, html.index)[0];
            if (opening) {
                startIndex = html.index;
                outerHTML = source.substring(startIndex, startIndex + opening.length);
            }
        }
        if (documentElement) {
            const leading = startIndex === -1 ? '<!DOCTYPE html>' + this.newline + '<html>' : source.substring(0, startIndex + outerHTML.length);
            if (startIndex === -1) {
                outerHTML = '<html>';
                startIndex = leading.length - outerHTML.length;
            }
            this.source = leading + this.newline + documentElement.innerHTML! + this.newline + '</html>';
            this.documentElement = documentElement;
        }
        else {
            this.source = normalize ? DomWriter.normalize(source) : source;
        }
        if (outerHTML) {
            for (const item of items) {
                item.startIndex = startIndex;
                item.outerHTML = outerHTML;
            }
        }
        appending
            .sort((a, b) => {
                if (a.domIndex === b.domIndex) {
                    return b.appendOrder - a.appendOrder;
                }
                return b.domIndex - a.domIndex;
            })
            .forEach(item => this.append(item));
    }

    append(index: ElementIndex) {
        const documentName = this.documentName;
        const htmlElement = new HtmlElement(documentName, index);
        const id = uuid.v4();
        htmlElement.setAttribute(`data-${documentName}-id`, id);
        if (this.write(htmlElement, { append: index })) {
            (index.id ||= {})[documentName] = id;
            delete index.appendName;
            delete index.appendOrder;
            return htmlElement;
        }
        this.errors.push(new Error(`Unable to append ${(index.appendName || index.tagName).toUpperCase()} element at DOM index ${index.domIndex}`));
        return null;
    }
    write(element: HtmlElement, options?: WriteOptions) {
        let remove: Undef<boolean>,
            rename: Undef<boolean>,
            append: Undef<ElementIndex>;
        if (options) {
            ({ remove, rename, append } = options);
        }
        if (!remove && !append && !element.modified) {
            return true;
        }
        if (this.documentElement) {
            element.lowerCase = true;
        }
        const [output, replaceHTML, error] = element.write(this.source, options);
        if (output) {
            this.source = output;
            ++this.modifyCount;
            const index = element.index;
            if (append) {
                this.elements.push(index);
                ++index.domIndex;
                if (index.appendName && index.appendName !== index.tagName) {
                    index.tagName = index.appendName;
                    index.tagIndex = -1;
                    this.increment(index);
                    this.indexTag(index.tagName);
                }
                else {
                    this.increment(index);
                }
            }
            else if (remove) {
                return this.decrement(index, remove).length > 0;
            }
            else if (rename && element.tagName !== index.tagName) {
                this.renameTag(index, index.tagName);
            }
            this.update(index, replaceHTML);
            return true;
        }
        if (error) {
            this.errors.push(error);
        }
        ++this.failCount;
        return false;
    }
    update(index: ElementIndex, replaceHTML: string) {
        const domIndex = index.domIndex;
        for (const item of this.elements) {
            if (item.domIndex === domIndex) {
                item.startIndex = -1;
                item.endIndex = -1;
                item.outerHTML = replaceHTML;
            }
        }
    }
    updateByTag(index: TagIndex, replaceHTML: string) {
        const { tagName, tagIndex, tagCount } = index;
        for (const item of this.elements) {
            if (item.tagName === tagName) {
                if (item.tagCount === tagCount) {
                    if (item.tagIndex === tagIndex) {
                        item.startIndex = -1;
                        item.endIndex = -1;
                        item.outerHTML = replaceHTML;
                    }
                }
                else {
                    return false;
                }
            }
        }
        return true;
    }
    increment(index: ElementIndex) {
        const { domIndex, tagName, tagIndex } = index;
        for (const item of this.elements) {
            if (item === index) {
                if (tagIndex !== -1) {
                    ++item.tagIndex;
                    ++item.tagCount;
                }
                continue;
            }
            if (tagIndex !== -1 && item.tagName === tagName) {
                if (item.tagIndex > tagIndex) {
                    ++item.tagIndex;
                }
                ++item.tagCount;
            }
            if (item.domIndex >= domIndex) {
                ++item.domIndex;
            }
        }
    }
    decrement(index: ElementIndex, remove?: boolean) {
        const { domIndex, tagName, tagIndex } = index;
        const result: ElementIndex[] = [];
        for (const item of this.elements) {
            if (item.tagName === tagName) {
                if (item.tagIndex === tagIndex) {
                    result.push(item);
                }
                else {
                    if (item.tagIndex > tagIndex) {
                        --item.tagIndex;
                    }
                    if (remove) {
                        --item.tagCount;
                    }
                }
            }
            if (remove && item.domIndex > domIndex) {
                --item.domIndex;
            }
        }
        return result;
    }
    renameTag(index: ElementIndex, tagName: string) {
        const revised = this.decrement(index);
        if (revised.length) {
            const related = this.elements.find(item => item.tagName === tagName);
            if (related) {
                for (const item of revised) {
                    item.tagName = tagName;
                    item.tagIndex = -1;
                }
                this.indexTag(tagName);
            }
            else {
                for (const item of revised) {
                    item.tagName = tagName;
                    item.tagIndex = 0;
                    item.tagCount = 1;
                }
            }
        }
    }
    indexTag(tagName: string) {
        const elements: ElementIndex[] = [];
        const revised: ElementIndex[] = [];
        const tagIndex = new Set<number>();
        let domIndex = -1;
        for (const item of this.elements) {
            if (item.tagName === tagName) {
                if (item.tagIndex === -1) {
                    domIndex = item.domIndex;
                    revised.push(item);
                }
                else {
                    elements.push(item);
                }
                tagIndex.add(item.tagIndex);
            }
        }
        if (domIndex !== -1) {
            const length = tagIndex.size;
            let index = length - 1;
            tagIndex.clear();
            for (const item of elements) {
                if (item.domIndex > domIndex) {
                    ++item.tagIndex;
                }
                tagIndex.add(item.tagIndex);
                item.tagCount = length;
            }
            while (tagIndex.has(index)) {
                --index;
            }
            for (const item of revised) {
                item.tagIndex = index;
                item.tagCount = length;
            }
        }
    }
    setRawString(segmentHTML: string, replaceHTML: string) {
        const current = this.source;
        this.source = current.replace(segmentHTML, replaceHTML);
        return current !== this.source;
    }
    getRawString(startIndex: number, endIndex: number) {
        return this.source.substring(startIndex, endIndex);
    }
    spliceRawString(startIndex: number, endIndex: number, replaceHTML: string) {
        const source = this.source;
        this.source = source.substring(0, startIndex) + replaceHTML + source.substring(endIndex);
    }
    replaceAll(predicate: (elem: domhandler.Element) => boolean, callback: (elem: domhandler.Element, source: string) => Undef<string>) {
        let result = 0;
        new Parser(new DomHandler((err, dom) => {
            if (!err) {
                for (const target of domutils.findAll(predicate, dom).reverse()) {
                    const replaceHTML = callback(target, this.source);
                    if (replaceHTML) {
                        const nodes = domutils.getElementsByTagName(target.tagName, dom, true);
                        const tagIndex = nodes.findIndex(elem => elem === target);
                        if (tagIndex !== -1 && this.updateByTag({ tagName: target.tagName, tagIndex, tagCount: nodes.length }, replaceHTML)) {
                            const { startIndex, endIndex } = target;
                            this.spliceRawString(startIndex!, endIndex! + 1, replaceHTML);
                            ++result;
                            continue;
                        }
                    }
                    this.errors.push(new Error(`Unable to replace ${target.tagName.toUpperCase()} element`));
                }
            }
            else {
                this.errors.push(err);
            }
        }, { withStartIndices: true, withEndIndices: true })).end(this.source);
        return result;
    }
    hasErrors() {
        return this.errors.length > 0;
    }
}

export class HtmlElement implements IHtmlElement {
    public static hasInnerHTML(tagName: string) {
        return !SELF_CLOSING.includes(tagName);
    }

    public static splitOuterHTML(tagName: string, outerHTML: string, startIndex = -1): [string, string, string] {
        if (startIndex === -1) {
            const forward = outerHTML.split('>');
            const opposing = outerHTML.split('<');
            if (opposing.length === 1 || forward.length === 1) {
                return [outerHTML, '', ''];
            }
            else if (opposing.length === 2 && forward.length === 2 && /^<[^>]+>[\S\s]*?<\/[^>]+>$/i.test(outerHTML)) {
                return [forward[0] + '>', forward[1] + opposing[0], '<' + opposing[1]];
            }
        }
        const openIndex = startIndex === -1 ? 0 : startIndex;
        const length = outerHTML.length;
        const start: number[] = [];
        let opening: Undef<string>;
        for (let i = openIndex, quote = ''; i < length; ++i) {
            const ch = outerHTML[i];
            if (ch === '=') {
                if (!quote) {
                    while (isSpace(outerHTML[++i])) {}
                    switch (outerHTML[i]) {
                        case '"':
                            quote = '"';
                            start.push(i);
                            break;
                        case "'":
                            quote = "'";
                            start.push(i);
                            break;
                        case '>':
                            --i;
                            break;
                    }
                }
            }
            else if (ch === quote) {
                quote = '';
            }
            else if (ch === '>' && !quote) {
                opening = outerHTML.substring(openIndex, i + 1);
                break;
            }
        }
        if (!opening && start.length) {
            found: {
                for (const index of start.reverse()) {
                    for (let j = index + 1; j < length; ++j) {
                        if (outerHTML[j] === '>') {
                            opening = outerHTML.substring(openIndex, j + 1);
                            break found;
                        }
                    }
                }
            }
        }
        if (opening) {
            if (startIndex !== -1) {
                return [opening, '', ''];
            }
            else if (HtmlElement.hasInnerHTML(tagName)) {
                const q = opening.length;
                const index = outerHTML.lastIndexOf('<');
                if (q < index && q < length) {
                    return [opening, outerHTML.substring(q, index), outerHTML.substring(index)];
                }
            }
        }
        return [startIndex === -1 ? outerHTML : '', '', ''];
    }

    public lowerCase = false;

    private _modified = false;
    private _tagName = '';
    private _innerHTML: string;
    private readonly _attributes = new Map<string, Optional<string>>();

    constructor(public documentName: string, public readonly index: ElementIndex, attributes?: StandardMap) {
        const attrs = this._attributes;
        applyAttributes(attrs, index.attributes);
        applyAttributes(attrs, attributes);
        this._modified = attrs.size > 0;
        const [tagStart, innerHTML] = HtmlElement.splitOuterHTML(index.tagName, index.outerHTML);
        const hasValue = (name: string) => /^[a-z][a-z\d_\-:.]*$/.test(name) && !attrs.has(name);
        let pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]*))/g,
            source = tagStart,
            match: Null<RegExpExecArray>;
        while (match = pattern.exec(tagStart)) {
            const attr = match[1].toLowerCase();
            if (hasValue(attr)) {
                attrs.set(attr, match[2] || match[3] || match[4] || '');
            }
            source = source.replace(match[0], '');
        }
        pattern = /[^<]\s+([\w-:.]+)/g;
        while (match = pattern.exec(source)) {
            const attr = match[1].toLowerCase();
            if (hasValue(attr)) {
                attrs.set(attr, null);
            }
        }
        this._innerHTML = innerHTML;
    }

    setAttribute(name: string, value: string) {
        if (this._attributes.get(name = name.toLowerCase()) !== value) {
            this._attributes.set(name, value);
            this._modified = true;
        }
    }
    getAttribute(name: string) {
        return this._attributes.get(name.toLowerCase());
    }
    removeAttribute(...names: string[]) {
        const attrs = this._attributes;
        for (let key of names) {
            if (attrs.has(key = key.toLowerCase())) {
                attrs.delete(key);
                this._modified = true;
            }
        }
    }
    hasAttribute(name: string) {
        return this._attributes.has(name = name.toLowerCase());
    }
    write(source: string, options?: WriteOptions): [string, string, Null<Error>?] {
        let remove: Undef<boolean>,
            append: Undef<TagIndex>;
        if (options) {
            ({ remove, append } = options);
        }
        let error: Null<Error> = null;
        if (this._modified || remove || append) {
            const element = this.index;
            const replaceHTML = !remove || append ? this.outerHTML : '';
            const spliceSource = (index: [number, number, string]) => {
                const [startIndex, endIndex, trailing] = index;
                if (append) {
                    let leading = '',
                        newline: Undef<boolean>,
                        i = startIndex - 1;
                    while (isSpace(source[i])) {
                        leading = source[i--] + leading;
                        if (source[i] === '\n') {
                            newline = true;
                            break;
                        }
                    }
                    return source.substring(0, endIndex + 1) + (newline ? leading : '') + replaceHTML + (newline ? '\n' : '') + source.substring(endIndex + 1);
                }
                const content = replaceHTML + trailing;
                element.startIndex = startIndex;
                element.endIndex = startIndex + content.length - 1;
                return source.substring(0, startIndex) + content + source.substring(endIndex);
            };
            let tagName = element.tagName;
            if (tagName === 'html') {
                const startIndex = element.startIndex;
                if (startIndex !== undefined && startIndex !== -1) {
                    const opening = HtmlElement.splitOuterHTML('html', source, startIndex)[0];
                    if (opening) {
                        return [spliceSource([startIndex, startIndex + opening.length, '']), replaceHTML];
                    }
                }
                return ['', '', new Error('Unable to find HTML element')];
            }
            if (this.lowerCase) {
                tagName = tagName.toLowerCase();
            }
            const { tagCount, tagIndex } = element;
            const id = element.id[this.documentName];
            const hasId = (startIndex: number, endIndex?: number) => source.substring(startIndex, endIndex).includes(id!);
            const getTagStart = (startIndex: number, endIndex?: number): Null<[string, string]> => {
                if (hasId(startIndex, endIndex)) {
                    const tagStart = HtmlElement.splitOuterHTML(tagName, source, startIndex)[0];
                    if (tagStart) {
                        return [spliceSource([startIndex, startIndex + tagStart.length, '']), replaceHTML];
                    }
                }
                return null;
            };
            const foundIndex: [number, number, string][] = [];
            const openTag: number[] = [];
            const selfClosed = !HtmlElement.hasInnerHTML(tagName);
            const selfId = selfClosed && !!id;
            let tag = new RegExp(`<${escapeRegexp(tagName)}[\\s|>]`, !this.lowerCase ? 'gi' : 'g'),
                openCount = 0,
                result: Null<[string, string]>,
                match: Null<RegExpExecArray>;
            while (match = tag.exec(source)) {
                openTag.push(match.index);
                if (selfId && openCount && (result = getTagStart(openTag[openCount - 1], match.index))) {
                    return result;
                }
                ++openCount;
            }
            if (selfId && tagIndex === tagCount - 1 && openTag.length === tagCount && (result = getTagStart(openTag[tagCount - 1]))) {
                return result;
            }
            let sourceIndex: Undef<[number, number, string]>;
            if (openCount && !selfClosed) {
                found: {
                    const closeTag: number[] = [];
                    tag = new RegExp(`</${escapeRegexp(tagName)}>`, !this.lowerCase ? 'gi' : 'g');
                    while (match = tag.exec(source)) {
                        closeTag.push(match.index + match[0].length);
                    }
                    const closeCount = closeTag.length;
                    if (closeCount) {
                        for (let i = 0; i < openCount; ++i) {
                            let j = 0,
                                valid: Undef<boolean>;
                            if (i === closeCount - 1 && openCount === closeCount) {
                                j = i;
                                valid = true;
                            }
                            else {
                                closed: {
                                    const k = openTag[i];
                                    let start = i + 1;
                                    for ( ; j < closeCount; ++j) {
                                        const l = closeTag[j];
                                        if (l > k) {
                                            for (let m = start; m < openCount; ++m) {
                                                const n = openTag[m];
                                                if (n < l) {
                                                    ++start;
                                                    break;
                                                }
                                                else if (n > l) {
                                                    valid = true;
                                                    break closed;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            if (valid) {
                                const length = foundIndex.push([openTag[i], closeTag[j], '']);
                                if (id && length > 1) {
                                    const index = foundIndex[length - 2];
                                    if (hasId(index[0], openTag[i])) {
                                        sourceIndex = index;
                                        break found;
                                    }
                                }
                            }
                        }
                    }
                    if (foundIndex.length === tagCount) {
                        sourceIndex = foundIndex[tagIndex];
                    }
                }
            }
            if (!sourceIndex) {
                let target: Null<domhandler.Node>;
                [target, error] = DomWriter.findElement(source, element, this.documentName);
                if (target) {
                    const { startIndex, endIndex } = target;
                    sourceIndex = [startIndex!, endIndex! + 1, ''];
                }
            }
            if (sourceIndex) {
                let leading = '',
                    trailing = '',
                    i = sourceIndex[1];
                newline: {
                    let found: Undef<boolean>;
                    while (isSpace(source[i])) {
                        const ch = source[i++];
                        switch (ch.charCodeAt(0)) {
                            case 10:
                                found = true;
                            case 13:
                                break;
                            default:
                                if (found) {
                                    break newline;
                                }
                                break;
                        }
                        trailing += ch;
                    }
                }
                if (remove) {
                    i = sourceIndex[0] - 1;
                    while (isSpace(source[i])) {
                        leading = source[i--] + leading;
                    }
                    sourceIndex[0] -= leading.length;
                    sourceIndex[1] += trailing.length;
                    sourceIndex[2] = DomWriter.getNewlineString(leading, trailing);
                }
                return [spliceSource(sourceIndex), replaceHTML];
            }
        }
        return ['', '', error];
    }
    save(source: string, remove?: boolean): [string, Null<Error>?] {
        const [output, replaceHTML, err] = this.write(source, { remove });
        if (output) {
            this.index.outerHTML = replaceHTML;
        }
        return [output, err];
    }
    set tagName(value: string) {
        value = value.toLowerCase();
        if (value !== this.tagName) {
            this._tagName = value;
            if (!HtmlElement.hasInnerHTML(value)) {
                this.innerHTML = '';
            }
            this._modified = true;
        }
    }
    get tagName() {
        return this._tagName ||= this.index.tagName;
    }
    get innerHTML() {
        return this._innerHTML;
    }
    set innerHTML(value) {
        if (value !== this._innerHTML) {
            this._innerHTML = value;
            this._modified = true;
        }
    }
    get outerHTML() {
        const appendName = this.index.appendName;
        const tagName = appendName && appendName.toLowerCase() || this.tagName;
        let outerHTML = '<' + tagName;
        for (const [key, value] of this._attributes) {
            if (value !== undefined) {
                outerHTML += ' ' + key + (value !== null ? `="${value.replace(/"/g, '&quot;')}"` : '');
            }
        }
        outerHTML += '>';
        if (HtmlElement.hasInnerHTML(tagName) && tagName !== 'html') {
            outerHTML += this.innerHTML + `</${tagName}>`;
        }
        return outerHTML;
    }
    get modified() {
        return this._modified;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DomWriter, HtmlElement };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}