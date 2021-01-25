import type { ElementIndex } from '../../types/lib/squared';

import type { IDomWriter, IHtmlElement, RebuildOptions, WriteOptions } from './document';

import escapeRegexp = require('escape-string-regexp');

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

    public static minifySpace(value: string) {
        return value.replace(/[\s]+/g, '');
    }

    public static getNewlineString(leading: string, trailing: string) {
        return leading.includes('\n') || /(?:\r?\n){2,}$/.test(trailing) ? (leading + trailing).includes('\r') ? '\r\n' : '\n' : '';
    }

    public source: string;
    public errors: Error[] = [];
    public failCount = 0;
    public modifyCount = 0;
    public documentElement: Null<ElementIndex> = null;

    constructor(source: string, public elements: ElementIndex[], normalize?: boolean) {
        const items = elements.filter(item => item.tagName === 'HTML');
        const html = this.getDocumentElement(source);
        let documentElement: Undef<ElementIndex>,
            startIndex = -1;
        if (html) {
            startIndex = html.startIndex!;
            const [opening, closing] = HtmlElement.splitOuterHTML(source, startIndex);
            if (opening && closing) {
                const outerHTML = source.substring(startIndex, startIndex + opening.length);
                for (const item of items) {
                    item.startIndex = html.startIndex!;
                    item.outerHTML = outerHTML;
                    if (item.innerHTML) {
                        documentElement = item;
                    }
                }
            }
        }
        const newline = source.includes('\r\n') ? '\r\n' : '\n';
        let doctype = '';
        if (!documentElement && (documentElement = items.find(item => item.innerHTML))) {
            doctype = '<!DOCTYPE html>' + newline;
            startIndex = doctype.length;
            documentElement.startIndex = startIndex;
            documentElement.outerHTML = '<html>';
        }
        if (documentElement) {
            this.source = doctype + source.substring(0, startIndex + documentElement.outerHTML.length) + newline + documentElement.innerHTML! + newline + '</html>';
            this.documentElement = documentElement;
        }
        else {
            this.source = normalize ? DomWriter.normalize(source) : source;
        }
    }

    write(element: HtmlElement, options?: WriteOptions) {
        let remove: Undef<boolean>,
            rename: Undef<boolean>;
        if (options) {
            ({ remove, rename } = options);
        }
        if (this.documentElement) {
            element.lowercase = true;
        }
        const [output, replaceHTML, error] = element.write(this.source, remove);
        if (output) {
            const position = element.position;
            this.source = output;
            ++this.modifyCount;
            if (remove) {
                return this.decrement(position).length > 0;
            }
            else if (rename) {
                const tagName = element.tagName.toUpperCase();
                if (tagName !== position.tagName.toUpperCase()) {
                    const result = this.renameTag(position, tagName);
                    this.rebuild(position, replaceHTML, true);
                    return result;
                }
            }
            this.rebuild(position, replaceHTML);
            return true;
        }
        if (error) {
            this.errors.push(error);
        }
        ++this.failCount;
        return false;
    }
    rebuild(index: ElementIndex, replaceHTML: string, options?: RebuildOptions | true) {
        const { tagName, tagIndex, outerHTML, outerIndex, outerCount } = index;
        if (tagName === 'HTML') {
            return;
        }
        const elements: ElementIndex[] = [];
        const related: ElementIndex[] = [];
        const failAll = (nodes: ElementIndex[]) => {
            for (const item of nodes) {
                item.outerIndex = -1;
                item.outerCount = 0;
            }
        };
        for (const item of this.elements) {
            if (item.tagName === tagName) {
                if (item.tagIndex === tagIndex) {
                    item.outerHTML = replaceHTML;
                    related.push(item);
                }
                elements.push(item);
            }
            item.startIndex = -1;
            item.endIndex = -1;
        }
        if (options) {
            if (options !== true) {
                const previous = elements.filter(item => item.outerHTML === outerHTML);
                if (previous.length) {
                    const { nodes, sourceIndex } = options;
                    const matched: number[] = [];
                    const length = options.nodes.length;
                    let failed: Undef<boolean>;
                    if (length === previous[0].tagCount) {
                        for (let i = 0; i < length; ++i) {
                            const { startIndex, endIndex } = nodes[i];
                            if (this.source.substring(startIndex!, endIndex! + 1) === outerHTML) {
                                matched.push(i);
                            }
                        }
                    }
                    else {
                        failed = true;
                    }
                    if (matched.length === previous[0].outerCount - 1) {
                        for (const item of previous) {
                            const i = matched.findIndex(value => value === item.tagIndex);
                            if (i !== -1) {
                                if (nodes[i].startIndex! >= sourceIndex) {
                                    --item.outerIndex;
                                }
                                --item.outerCount;
                            }
                            else {
                                failed = true;
                                break;
                            }
                        }
                    }
                    if (failed) {
                        failAll(previous);
                    }
                }
            }
        }
        else {
            for (const item of elements) {
                if (item.tagName === tagName && item.outerCount === outerCount && item.outerHTML === outerHTML) {
                    if (item.outerIndex > outerIndex) {
                        --item.outerIndex;
                    }
                    --item.outerCount;
                }
            }
        }
        const next = elements.filter(item => !related.includes(item) && item.outerHTML === replaceHTML);
        if (next.length) {
            next.push(...related);
            new Parser(new DomHandler((err, dom) => {
                if (!err) {
                    const tag = tagName.toLowerCase();
                    const nodes = domutils.findAll(elem => elem.tagName === tag, dom);
                    const matched: number[] = [];
                    const length = nodes.length;
                    let failed: Undef<boolean>;
                    if (length === next[0].tagCount) {
                        for (let i = 0; i < length; ++i) {
                            const { startIndex, endIndex } = nodes[i];
                            if (this.source.substring(startIndex!, endIndex! + 1) === replaceHTML) {
                                matched.push(i);
                            }
                        }
                    }
                    else {
                        failed = true;
                    }
                    if (matched.length) {
                        for (const item of next) {
                            const i = matched.findIndex(value => value === item.tagIndex);
                            if (i !== -1) {
                                item.outerIndex = i;
                                item.outerCount = matched.length;
                            }
                            else {
                                failed = true;
                                break;
                            }
                        }
                    }
                    else {
                        failed = true;
                    }
                    if (failed) {
                        failAll(next);
                    }
                }
                else {
                    this.errors.push(err);
                }
            }, { withStartIndices: true, withEndIndices: true })).end(this.source);
        }
        else {
            for (const item of related) {
                item.outerIndex = 0;
                item.outerCount = 1;
            }
        }
    }
    decrement(index: ElementIndex) {
        const { tagName, tagIndex, outerHTML, outerIndex, outerCount } = index;
        const result: ElementIndex[] = [];
        for (const item of this.elements) {
            if (item.tagName === tagName) {
                if (item.tagIndex === tagIndex) {
                    item.tagIndex = -1;
                    item.tagCount = 0;
                    item.outerCount = 1;
                    item.outerIndex = 0;
                    result.push(item);
                    continue;
                }
                else if (item.tagIndex > tagIndex) {
                    --item.tagIndex;
                }
                if (item.outerCount === outerCount && item.outerHTML === outerHTML) {
                    if (item.outerIndex > outerIndex) {
                        --item.outerIndex;
                    }
                    --item.outerCount;
                }
                --item.tagCount;
            }
        }
        return result;
    }
    renameTag(index: ElementIndex, tagName: string) {
        const revised = this.decrement(index);
        for (const item of revised) {
            item.tagName = tagName;
        }
        return this.insertTag(tagName, revised);
    }
    insertTag(tagName: string, revised: ElementIndex[] = []) {
        const elements: ElementIndex[] = [];
        const tagCount = new Set<number>();
        let result = false;
        for (const item of this.elements) {
            if (item.tagName === tagName) {
                if (item.tagIndex !== -1) {
                    elements.push(item);
                }
                tagCount.add(item.tagIndex);
            }
        }
        if (elements.length) {
            elements.sort((a, b) => a.outerHTML === b.outerHTML ? a.tagIndex - b.tagIndex : 0);
            new Parser(new DomHandler((err, dom) => {
                if (!err) {
                    const tag = tagName.toLowerCase();
                    const nodes = domutils.findAll(elem => elem.tagName === tag, dom);
                    const length = nodes.length;
                    if (length === tagCount.size) {
                        const foundIndex = new Set<number>();
                        for (let i = 0; i < length; ++i) {
                            const { startIndex, endIndex } = nodes[i];
                            for (let j = 0; j < revised.length; ++j) {
                                const item = revised[j];
                                if (item.startIndex === startIndex && item.endIndex === endIndex) {
                                    item.tagIndex = i;
                                    item.tagCount = tagCount.size;
                                    revised.splice(j--, 1);
                                    foundIndex.add(i);
                                }
                            }
                        }
                        for (let i = 0; i < length; ++i) {
                            if (!foundIndex.has(i)) {
                                const { startIndex, endIndex } = nodes[i];
                                for (let j = 0; j < elements.length; ++j) {
                                    const item = elements[j];
                                    const sourceHTML = this.source.substring(startIndex!, endIndex! + 1);
                                    if (sourceHTML === item.outerHTML) {
                                        item.tagIndex = i;
                                        item.tagCount = tagCount.size;
                                        foundIndex.add(i);
                                        elements.splice(j--, 1);
                                    }
                                }
                            }
                        }
                        result = foundIndex.size === tagCount.size;
                    }
                }
                else {
                    this.errors.push(err);
                }
            }, { withStartIndices: true, withEndIndices: true })).end(this.source);
        }
        else {
            result = true;
            for (const item of revised) {
                item.tagIndex = 0;
                item.tagCount = 1;
            }
        }
        return result;
    }
    findTagIndex(element: domhandler.Element, dom: domhandler.Node[], replaceHTML?: string) {
        const nodes = domutils.findAll(elem => elem.tagName === element.tagName, dom);
        const tagIndex = nodes.findIndex(elem => elem === element);
        if (replaceHTML && tagIndex !== -1) {
            const { startIndex, endIndex } = element;
            if (startIndex !== null && endIndex !== null) {
                const source = this.source;
                this.source = source.substring(0, startIndex) + replaceHTML + source.substring(endIndex + 1);
                this.rebuild({
                        tagName: element.tagName.toUpperCase(),
                        tagIndex,
                        tagCount: -1,
                        outerHTML: source.substring(startIndex, endIndex + 1),
                        outerIndex: 0,
                        outerCount: 1
                    },
                    replaceHTML,
                    { nodes, sourceIndex: startIndex }
                );
            }
        }
        return tagIndex;
    }
    setRawString(segmentHTML: string, replaceHTML: string) {
        const current = this.source;
        this.source = current.replace(segmentHTML, replaceHTML);
        return current !== this.source;
    }
    getRawString(startIndex: number, endIndex: number) {
        return this.source.substring(startIndex, endIndex);
    }
    getDocumentElement(source: string): Null<domhandler.Node> {
        let result: Null<domhandler.Node> = null;
        new Parser(new DomHandler((err, dom) => {
            if (!err) {
                result = domutils.findOne(elem => elem.tagName === 'html', dom);
            }
            else {
                this.errors.push(err);
            }
        }, { withStartIndices: true, withEndIndices: true })).end(source);
        return result;
    }
    hasErrors() {
        return this.errors.length > 0;
    }
}

export class HtmlElement implements IHtmlElement {
    public static hasInnerHTML(tagName: string) {
        return !SELF_CLOSING.includes(tagName.toLowerCase());
    }

    public static splitOuterHTML(outerHTML: string, startIndex = -1): [string, string, string] {
        const forward = outerHTML.split('>');
        const opposing = outerHTML.split('<');
        if (startIndex === -1) {
            if (opposing.length === 1 || forward.length === 1) {
                return [outerHTML, '', ''];
            }
            else if (opposing.length === 2 && forward.length === 2 && /^<[^>]+>[\S\s]*?<\/[^>]+>$/i.test(outerHTML)) {
                return [forward[0] + '>', '<' + opposing[1], forward[1] + opposing[0]];
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
            const q = opening.length;
            const index = outerHTML.lastIndexOf('<');
            if (q < index && q < length) {
                return [opening, outerHTML.substring(index), outerHTML.substring(q, index)];
            }
        }
        return [outerHTML, '', ''];
    }

    public lowercase = false;

    private _modified = false;
    private _tagName = '';
    private _tagStart: string;
    private _tagEnd: string;
    private _innerHTML: string;
    private readonly _attributes = new Map<string, Optional<string>>();

    constructor(public readonly position: ElementIndex, attributes?: StandardMap) {
        if (attributes) {
            for (const key in attributes) {
                attributes.set(key.toLowerCase(), attributes[key]);
            }
            this._modified = Object.keys(attributes).length > 0;
        }
        const [tagStart, tagEnd, innerHTML] = HtmlElement.splitOuterHTML(position.outerHTML);
        const hasValue = (name: string) => /^[a-z][a-z\d-:.]*$/.test(name) && !this._attributes.has(name);
        let pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]*))/g,
            source = tagStart,
            match: Null<RegExpExecArray>;
        while (match = pattern.exec(tagStart)) {
            const attr = match[1].toLowerCase();
            if (hasValue(attr)) {
                this._attributes.set(attr, match[2] || match[3] || match[4] || '');
            }
            source = source.replace(match[0], '');
        }
        pattern = /(<|\s+)([^\s="'/>]+)/g;
        while (match = pattern.exec(source)) {
            if (match[1][0] === '<') {
                continue;
            }
            else {
                const attr = match[2].toLowerCase();
                if (hasValue(attr)) {
                    this._attributes.set(attr, null);
                }
            }
        }
        this._tagStart = tagStart;
        this._tagEnd = tagEnd;
        this._innerHTML = innerHTML;
    }
    setAttribute(name: string, value: string) {
        this._attributes.set(name.toLowerCase(), value);
        this._modified = true;
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
    write(source: string, remove?: boolean): [string, string, Error?] {
        let error: Undef<Error>;
        if (this._modified || remove) {
            const position = this.position;
            const { outerIndex, outerCount, outerHTML } = position;
            const replaceHTML = !remove ? this.outerHTML : '';
            const spliceSource = (index: [number, number, string]) => {
                const [startIndex, endIndex, trailing] = index;
                const content = replaceHTML + trailing;
                position.startIndex = startIndex;
                position.endIndex = startIndex + content.length - 1;
                return source.substring(0, startIndex) + content + source.substring(endIndex);
            };
            let tagName = position.tagName;
            if (outerIndex !== -1 && (outerCount === 1 || !HtmlElement.hasInnerHTML(tagName))) {
                const foundIndex: [number, number, string][] = [];
                let pattern = escapeRegexp(outerHTML),
                    match: Null<RegExpExecArray>;
                if (remove) {
                    pattern = '(\\s*)' + pattern + '[ \\t]*((?:\\r?\\n)*)';
                }
                const tag = new RegExp(pattern, 'g');
                while (match = tag.exec(source)) {
                    foundIndex.push([match.index, match.index + match[0].length, remove ? DomWriter.getNewlineString(match[1], match[2]) : '']);
                }
                if (foundIndex.length === outerCount) {
                    return [spliceSource(foundIndex[outerIndex]), replaceHTML, error];
                }
            }
            if (tagName === 'HTML') {
                const startIndex = position.startIndex;
                if (startIndex !== undefined && startIndex !== -1) {
                    const [opening, closing] = HtmlElement.splitOuterHTML(source, startIndex);
                    if (opening && closing) {
                        return [spliceSource([startIndex, startIndex + opening.length, '']), replaceHTML];
                    }
                }
                return ['', '', new Error('Unable to find HTML element')];
            }
            const { tagCount, tagIndex } = position;
            let index: Undef<[number, number, string]>;
            if (this._tagStart && this._tagEnd) {
                let flags = 'g';
                if (this.lowercase) {
                    tagName = tagName.toLowerCase();
                }
                else {
                    flags += 'i';
                }
                const foundIndex: [number, number, string][] = [];
                const openTag: number[] = [];
                let tag = new RegExp(`<${escapeRegexp(tagName)}\\b`, flags),
                    match: Null<RegExpExecArray>;
                while (match = tag.exec(source)) {
                    openTag.push(match.index);
                }
                const open = openTag.length;
                if (open) {
                    const closeTag: number[] = [];
                    tag = new RegExp(`</${escapeRegexp(tagName)}>`, flags);
                    while (match = tag.exec(source)) {
                        closeTag.push(match.index + match[0].length);
                    }
                    const close = closeTag.length;
                    if (close) {
                        for (let i = 0; i < open; ++i) {
                            let j = 0,
                                valid: Undef<boolean>;
                            if (i === close - 1 && open === close) {
                                j = i;
                                valid = true;
                            }
                            else {
                                found: {
                                    const k = openTag[i];
                                    let start = i + 1;
                                    for ( ; j < close; ++j) {
                                        const l = closeTag[j];
                                        if (l > k) {
                                            for (let m = start; m < open; ++m) {
                                                const n = openTag[m];
                                                if (n < l) {
                                                    ++start;
                                                    break;
                                                }
                                                else if (n > l) {
                                                    valid = true;
                                                    break found;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            if (valid) {
                                foundIndex.push([openTag[i], closeTag[j], '']);
                            }
                        }
                    }
                    if (foundIndex.length === tagCount) {
                        index = foundIndex[tagIndex];
                    }
                }
            }
            if (!index) {
                new Parser(new DomHandler((err, dom) => {
                    if (!err) {
                        tagName = tagName.toLowerCase();
                        const nodes = domutils.findAll(elem => elem.tagName === tagName, dom);
                        if (nodes.length === tagCount) {
                            const { startIndex, endIndex } = nodes[tagIndex];
                            index = [startIndex!, endIndex! + 1, ''];
                        }
                    }
                    else {
                        error = err;
                    }
                }, { withStartIndices: true, withEndIndices: true })).end(source);
            }
            if (index) {
                let leading = '',
                    trailing = '',
                    i = index[1];
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
                    i = index[0] - 1;
                    while (isSpace(source[i])) {
                        leading = source[i--] + leading;
                    }
                    index[0] -= leading.length;
                    index[1] += trailing.length;
                    index[2] = DomWriter.getNewlineString(leading, trailing);
                }
                return [spliceSource(index), replaceHTML];
            }
        }
        return ['', '', error];
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
        return this._tagName ||= this.position.tagName.toLowerCase();
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
        const tagName = this.tagName;
        let outerHTML = '<' + tagName;
        for (const [key, value] of this._attributes) {
            if (value !== undefined) {
                outerHTML += ' ' + key + (value !== null ? `="${value.replace(/"/g, '&quot;')}"` : '');
            }
        }
        outerHTML += '>';
        if (HtmlElement.hasInnerHTML(tagName) && tagName.toLowerCase() !== 'html') {
            outerHTML += this.innerHTML + `</${tagName}>`;
        }
        return outerHTML;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DomWriter, HtmlElement };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}