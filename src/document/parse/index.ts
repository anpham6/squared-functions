import type { TagIndex } from '../../types/lib/squared';

import type { ElementIndex, FindElementOptions, IDomWriter, IHtmlElement, ParserResult, SaveResult, WriteOptions, WriteResult } from './document';

import escapeRegexp = require('escape-string-regexp');
import uuid = require('uuid');

import htmlparser2 = require('htmlparser2');
import domhandler = require('domhandler');
import domutils = require('domutils');

type WriteSourceIndex = [number, number, string?];

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

function escapeXmlString(value: string) {
    return value.replace(/[<>"'&]/g, (...capture) => {
        switch (capture[0]) {
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            case "'":
                return '&apos;';
            case '&':
                return '&amp;';
            default:
                return capture[0];
        }
    });
}

const getAttrId = (document: string) => `data-${document}-id`;

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
        let element: Null<domhandler.Node> = null,
            error: Null<Error> = null;
        new Parser(new DomHandler((err, dom) => {
            if (!err) {
                element = domutils.findOne(elem => elem.tagName === 'html', dom);
            }
            else {
                error = err;
            }
        }, { withStartIndices: true, withEndIndices: true })).end(source);
        return { element, error };
    }

    public static findElement(source: string, element: ElementIndex, options?: FindElementOptions): ParserResult {
        let document: Undef<string>,
            byId: Undef<boolean>;
        if (options) {
            ({ document, byId } = options);
        }
        const result: ParserResult = { element: null, error: null };
        new Parser(new DomHandler((err, dom) => {
            if (!err) {
                const nodes = domutils.getElementsByTagName(element.tagName, dom, true);
                let index = -1;
                if (document) {
                    const id = element.id?.[document];
                    if (id) {
                        const documentId = getAttrId(document);
                        index = nodes.findIndex(elem => elem.attribs[documentId] === id);
                        if (index !== -1) {
                            result.element = nodes[index];
                            byId = true;
                        }
                    }
                }
                if (!byId) {
                    index = element.tagIndex;
                    if (nodes.length === element.tagCount && nodes[index]) {
                        result.element = nodes[index];
                    }
                }
                if (result.element) {
                    result.tagName = element.tagName;
                    result.tagIndex = index;
                    result.tagCount = nodes.length;
                }
            }
            else {
                result.error = err;
            }
        }, { withStartIndices: true, withEndIndices: true })).end(source);
        return result;
    }

    public static getNewlineString(leading: string, trailing: string, newline?: string) {
        return leading.includes('\n') || /(?:\r?\n){2,}$/.test(trailing) ? newline ? newline : (leading + trailing).includes('\r') ? '\r\n' : '\n' : '';
    }

    public source: string;
    public modifyCount = 0;
    public failCount = 0;
    public errors: Error[] = [];
    public documentElement: Null<ElementIndex> = null;
    public newline = '\n';

    private _tagCount: ObjectMap<number> = {};

    constructor(public documentName: string, source: string, public elements: ElementIndex[], normalize = true) {
        const items: ElementIndex[] = [];
        const appending: Required<ElementIndex>[] = [];
        for (let i = 0; i < elements.length; ++i) {
            const item = elements[i];
            const tagName = item.tagName.toLowerCase();
            item.tagName = tagName;
            if (item.tagName === 'html') {
                items.push(item);
            }
            else if (item.append && item.domIndex > 0 && item.tagName) {
                item.append.tagName = item.append.tagName.toLowerCase();
                appending.push(item as Required<ElementIndex>);
                elements.splice(i--, 1);
                continue;
            }
            this._tagCount[tagName] = item.tagCount;
        }
        const documentElement = items.find(item => item.innerHTML);
        const html = /<\s*html[\s|>]/i.exec(source);
        if (source.includes('\r\n')) {
            this.newline = '\r\n';
        }
        let outerHTML = '',
            startIndex = -1;
        if (html) {
            const closeIndex = HtmlElement.findCloseTag(source, html.index);
            if (closeIndex !== -1) {
                startIndex = html.index;
                outerHTML = source.substring(startIndex, closeIndex + 1);
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
            const endIndex = startIndex + outerHTML.length - 1;
            for (const item of items) {
                item.startIndex = startIndex;
                item.endIndex = endIndex;
                item.outerHTML = outerHTML;
            }
        }
        appending
            .sort((a, b) => {
                if (a.domIndex === b.domIndex) {
                    return b.append.order - a.append.order;
                }
                return b.domIndex - a.domIndex;
            })
            .forEach(item => this.append(item));
    }

    append(element: ElementIndex) {
        const data = element.append;
        if (data) {
            const documentName = this.documentName;
            const htmlElement = new HtmlElement(documentName, element);
            const id = uuid.v4();
            const tagName = data.tagName;
            if (!(tagName in this._tagCount)) {
                this._tagCount[tagName] = data.tagCount;
            }
            htmlElement.setAttribute(getAttrId(documentName), id);
            if (this.write(htmlElement, { append: element })) {
                (element.id ||= {})[documentName] = id;
                delete element.append;
                return htmlElement;
            }
            this.errors.push(new Error(`Unable to append element ${tagName.toUpperCase()} at DOM index ${element.domIndex}`));
        }
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
        element.newline = this.newline;
        const [output, outerHTML, error] = element.write(this.source, options);
        if (output) {
            this.source = output;
            ++this.modifyCount;
            const index = element.index;
            if (append) {
                this.elements.push(index);
                ++index.domIndex;
                index.outerHTML = outerHTML;
                const tagName = index.append!.tagName;
                if (tagName !== index.tagName) {
                    index.tagName = tagName;
                    index.tagIndex = -1;
                    this.increment(index);
                    this.indexTag(tagName, true);
                }
                else {
                    this.increment(index);
                }
            }
            else if (remove) {
                return this.decrement(index, remove).length > 0;
            }
            else if (rename && element.tagName !== index.tagName) {
                this.renameTag(index, element.tagName);
            }
            this.update(index, outerHTML);
            return true;
        }
        if (error) {
            this.errors.push(error);
        }
        ++this.failCount;
        return false;
    }
    update(element: ElementIndex, outerHTML: string) {
        const { domIndex, startIndex = -1 } = element;
        for (const item of this.elements) {
            if (item.domIndex === domIndex) {
                item.outerHTML = outerHTML;
            }
            else if (item.startIndex !== undefined && (item.startIndex >= startIndex || startIndex === -1 && item.tagName !== 'html')) {
                delete item.startIndex;
                delete item.endIndex;
            }
        }
    }
    updateByTag(element: Required<TagIndex>, outerHTML: string, startIndex: number, endIndex: number) {
        const { tagName, tagIndex, tagCount } = element;
        for (const item of this.elements) {
            if (item.tagName === tagName) {
                if (item.tagCount === tagCount) {
                    if (item.tagIndex === tagIndex) {
                        item.startIndex = startIndex;
                        item.endIndex = endIndex;
                        item.outerHTML = outerHTML;
                        continue;
                    }
                }
                else {
                    return false;
                }
            }
            if (item.startIndex !== undefined && item.startIndex >= startIndex) {
                delete item.startIndex;
                delete item.endIndex;
            }
        }
        this.spliceRawString(outerHTML, startIndex, endIndex);
        return true;
    }
    increment(element: ElementIndex) {
        const { domIndex, tagName, tagIndex } = element;
        for (const item of this.elements) {
            if (item === element) {
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
        ++this._tagCount[tagName];
    }
    decrement(element: ElementIndex, remove?: boolean) {
        const { domIndex, tagName, tagIndex } = element;
        const result: ElementIndex[] = this.elements.filter(item => item.tagName === tagName && item.tagIndex === tagIndex);
        if (result.length) {
            for (const item of this.elements) {
                if (item.tagName === tagName && item.tagIndex !== tagIndex) {
                    if (item.tagIndex > tagIndex) {
                        --item.tagIndex;
                    }
                    --item.tagCount;
                }
                if (remove && item.domIndex > domIndex) {
                    --item.domIndex;
                }
            }
            --this._tagCount[tagName];
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
        else {
            this.errors.push(new Error(`Unable to rename element ${index.tagName.toUpperCase()} -> ${tagName.toUpperCase()} at DOM index ${index.domIndex}`));
        }
    }
    indexTag(tagName: string, append?: boolean) {
        const elements: ElementIndex[] = [];
        const revised: ElementIndex[] = [];
        const index = new Set<number>();
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
                index.add(item.tagIndex);
            }
        }
        const tagCount = this._tagCount[tagName];
        if (append && tagCount === 1) {
            if (!elements.length) {
                for (const item of revised) {
                    item.tagIndex = 0;
                    item.tagCount = 1;
                }
                return true;
            }
        }
        else if (index.size !== tagCount) {
            if (domIndex !== -1) {
                let i = tagCount - 1;
                index.clear();
                for (const item of elements) {
                    if (item.domIndex > domIndex) {
                        ++item.tagIndex;
                    }
                    index.add(item.tagIndex);
                    item.tagCount = tagCount;
                }
                while (index.has(i)) {
                    --i;
                }
                for (const target of revised) {
                    target.tagIndex = i;
                    target.tagCount = tagCount;
                }
            }
            return true;
        }
        this.errors.push(new Error(`Unable to index ${tagName.toUpperCase()}`));
        return false;
    }
    close() {
        return this.source = this.source.replace(new RegExp(`\\s+${getAttrId(this.documentName)}="[^"]+"`, 'g'), '');
    }
    setRawString(sourceHTML: string, outerHTML: string) {
        const current = this.source;
        this.source = current.replace(sourceHTML, outerHTML);
        return current !== this.source;
    }
    getRawString(startIndex: number, endIndex: number) {
        return this.source.substring(startIndex, endIndex);
    }
    spliceRawString(outerHTML: string, startIndex: number, endIndex: number) {
        const source = this.source;
        return this.source = source.substring(0, startIndex) + outerHTML + source.substring(endIndex + 1);
    }
    replaceAll(predicate: (elem: domhandler.Element) => boolean, callback: (elem: domhandler.Element, source: string) => Undef<string>) {
        let result = 0;
        new Parser(new DomHandler((err, dom) => {
            if (!err) {
                for (const target of domutils.findAll(predicate, dom).reverse()) {
                    const outerHTML = callback(target, this.source);
                    if (outerHTML) {
                        const nodes = domutils.getElementsByTagName(target.tagName, dom, true);
                        const tagIndex = nodes.findIndex(elem => elem === target);
                        if (tagIndex !== -1 && this.updateByTag({ tagName: target.tagName, tagIndex, tagCount: nodes.length }, outerHTML, target.startIndex!, target.endIndex!)) {
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

    public static findCloseTag(source: string, startIndex = 0) {
        const length = source.length;
        const start: number[] = [];
        for (let i = startIndex, quote = ''; i < length; ++i) {
            const ch = source[i];
            if (ch === '=') {
                if (!quote) {
                    while (isSpace(source[++i])) {}
                    switch (source[i]) {
                        case '"':
                            quote = '"';
                            start.push(i);
                            break;
                        case "'":
                            quote = "'";
                            start.push(i);
                            break;
                        case '>':
                            return i;
                    }
                }
            }
            else if (ch === quote) {
                quote = '';
            }
            else if (ch === '>' && !quote) {
                return i;
            }
        }
        if (start.length) {
            for (const index of start.reverse()) {
                for (let j = index + 1; j < length; ++j) {
                    if (source[j] === '>') {
                        return j;
                    }
                }
            }
        }
        return -1;
    }

    public static splitOuterHTML(tagName: string, outerHTML: string): [string, string] {
        const forward = outerHTML.split('>');
        const opposing = outerHTML.split('<');
        if (opposing.length === 2 || forward.length === 2) {
            return HtmlElement.hasInnerHTML(tagName) ? [outerHTML.replace(/\s*\/?\s*>$/, ''), ''] : [outerHTML, ''];
        }
        else if (opposing.length === 3 && forward.length === 3 && /^<[^>]+>[\S\s]*?<\/[^>]+>$/.test(outerHTML)) {
            return [forward[0] + '>', !forward[2] ? '' : forward[1].substring(0, forward[1].length - opposing[2].length)];
        }
        if (HtmlElement.hasInnerHTML(tagName)) {
            const closeIndex = HtmlElement.findCloseTag(outerHTML) + 1;
            let openTag: Undef<string>;
            if (closeIndex !== 0) {
                const lastIndex = outerHTML.lastIndexOf('<');
                openTag = outerHTML.substring(0, closeIndex);
                if (closeIndex < lastIndex && closeIndex < outerHTML.length) {
                    return [openTag, outerHTML.substring(closeIndex, lastIndex)];
                }
            }
            return [openTag || `<${tagName}>`, ''];
        }
        return [outerHTML, ''];
    }

    public lowerCase = false;
    public newline = '\n';

    private _modified = false;
    private _tagName = '';
    private _innerHTML = '';
    private readonly _attributes = new Map<string, Optional<string>>();

    constructor(public documentName: string, public readonly index: ElementIndex, attributes?: StandardMap) {
        const attrs = this._attributes;
        applyAttributes(attrs, index.attributes);
        applyAttributes(attrs, attributes);
        this._modified = attrs.size > 0;
        if (index.outerHTML) {
            const [tagStart, innerHTML] = HtmlElement.splitOuterHTML(index.tagName, index.outerHTML);
            if (tagStart) {
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
        }
        else if (index.innerHTML) {
            this._innerHTML = index.innerHTML;
        }
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
    write(source: string, options?: WriteOptions): WriteResult {
        let remove: Undef<boolean>,
            append: Undef<TagIndex>;
        if (options) {
            ({ remove, append } = options);
        }
        let error: Null<Error> = null;
        if (this._modified || remove || append) {
            const element = this.index;
            const outerHTML = !remove || append ? this.outerHTML : '';
            const spliceSource = (index: WriteSourceIndex) => {
                const [startIndex, endIndex, trailing = ''] = index;
                element.startIndex = startIndex;
                element.endIndex = startIndex + outerHTML.length - 1;
                if (append) {
                    let leading = '',
                        newline: Undef<boolean>,
                        i = startIndex - 1;
                    while (isSpace(source[i])) {
                        if (source[i] === '\n') {
                            newline = true;
                            break;
                        }
                        leading = source[i--] + leading;
                    }
                    return source.substring(0, endIndex + 2) + (!newline ? this.newline : '') + leading + outerHTML + this.newline + source.substring(endIndex + 2);
                }
                return source.substring(0, startIndex) + outerHTML + (!remove ? trailing : '') + source.substring(endIndex + 1);
            };
            const errorResult = (message: string): [string, string, Error] => ['', '', new Error(`${tagName.toUpperCase()} ${tagIndex}: ${message}`)];
            const { tagName, tagCount, tagIndex, startIndex, endIndex } = element;
            if (tagName === 'html') {
                const start = element.startIndex;
                if (start !== undefined && start !== -1) {
                    const end = HtmlElement.findCloseTag(source, start);
                    if (end !== -1) {
                        return [spliceSource([start, end]), outerHTML, error];
                    }
                }
                return errorResult('Element was not found');
            }
            if (startIndex !== undefined && endIndex !== undefined) {
                return [spliceSource([startIndex, endIndex]), outerHTML, error];
            }
            const id = element.id?.[this.documentName];
            if (append && !id) {
                return errorResult('Element id is missing.');
            }
            const foundIndex: WriteSourceIndex[] = [];
            const openTag: number[] = [];
            const selfClosed = !HtmlElement.hasInnerHTML(tagName);
            const selfId = selfClosed && !!id;
            const hasId = (start: number, end?: number) => !!id && source.substring(start, end).includes(id);
            const getTagStart = (start: number): Null<WriteResult> => {
                const end = HtmlElement.findCloseTag(source, start);
                return end !== -1 && hasId(start, end) ? [spliceSource([start, end]), outerHTML, error] : null;
            };
            let tag = new RegExp(`<${escapeRegexp(tagName)}[\\s|>]`, !this.lowerCase ? 'gi' : 'g'),
                openCount = 0,
                result: Null<WriteResult>,
                match: Null<RegExpExecArray>;
            while (match = tag.exec(source)) {
                if (selfId && (openCount === tagIndex || append) && (result = getTagStart(match.index))) {
                    return result;
                }
                openCount = openTag.push(match.index);
            }
            if (selfId && (tagIndex === tagCount - 1 && openCount === tagCount || append) && (result = getTagStart(openTag[openCount - 1]))) {
                return result;
            }
            let sourceIndex: Undef<WriteSourceIndex>;
            if (openCount && !selfClosed) {
                found: {
                    const closeIndex: number[] = [];
                    let foundCount = 0;
                    tag = new RegExp(`</${escapeRegexp(tagName)}>`, !this.lowerCase ? 'gi' : 'g');
                    while (match = tag.exec(source)) {
                        closeIndex.push(match.index + match[0].length - 1);
                    }
                    const closeCount = closeIndex.length;
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
                                        const l = closeIndex[j];
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
                                if (id) {
                                    let index: Undef<WriteSourceIndex>;
                                    if (append) {
                                        if (foundCount) {
                                            index = foundIndex[foundCount - 1];
                                        }
                                    }
                                    else if (foundCount === tagIndex + 1) {
                                        index = foundIndex[tagIndex];
                                    }
                                    if (index && hasId(index[0], openTag[i])) {
                                        sourceIndex = index;
                                        break found;
                                    }
                                }
                                foundCount = foundIndex.push([openTag[i], closeIndex[j]]);
                            }
                        }
                    }
                    if (append) {
                        sourceIndex = foundIndex[foundCount - 1];
                        if (!hasId(sourceIndex[0], sourceIndex[1])) {
                            return errorResult(`Element ${id!} was removed from the DOM.`);
                        }
                    }
                    else if (foundCount === tagCount) {
                        sourceIndex = foundIndex[tagIndex];
                    }
                }
            }
            if (!sourceIndex) {
                let target: Null<domhandler.Node>;
                ({ element: target, error } = DomWriter.findElement(source, element, { document: this.documentName, byId: !!append }));
                if (target) {
                    sourceIndex = [target.startIndex!, target.endIndex!];
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
                    sourceIndex[2] = DomWriter.getNewlineString(leading, trailing, this.newline);
                }
                return [spliceSource(sourceIndex), outerHTML, error];
            }
        }
        return ['', '', error];
    }
    save(source: string, options?: WriteOptions): SaveResult {
        const [output, outerHTML, err] = this.write(source, options);
        if (output) {
            this.index.outerHTML = outerHTML;
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
        let tagName: Undef<string>,
            textContent: Undef<string>;
        const append = this.index.append;
        if (append) {
            ({ tagName, textContent } = append);
        }
        else {
            tagName = this.tagName;
        }
        let outerHTML = '<' + tagName;
        for (const [key, value] of this._attributes) {
            if (value !== undefined) {
                outerHTML += ' ' + key + (value !== null ? `="${value.replace(/"/g, '&quot;')}"` : '');
            }
        }
        outerHTML += '>';
        if (HtmlElement.hasInnerHTML(tagName) && tagName !== 'html') {
            if (textContent) {
                switch (tagName) {
                    case 'script':
                    case 'style':
                        break;
                    default:
                        textContent = escapeXmlString(textContent);
                        break;
                }
            }
            outerHTML += (textContent || this.innerHTML) + `</${tagName}>`;
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