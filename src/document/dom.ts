import type { ElementIndex } from '../types/lib/squared';

import escapeRegexp = require('escape-string-regexp');

import htmlparser2 = require('htmlparser2');
import domhandler = require('domhandler');
import domutils = require('domutils');

const Parser = htmlparser2.Parser;
const DomHandler = domhandler.DomHandler;

function isSpace(ch: string) {
    const n = ch.charCodeAt(0);
    return n === 32 || n < 14 && n > 8;
}

export class DomWriter {
    public static minifySpace(value: string) {
        return value.replace(/[\s/]+/g, '');
    }

    public static getNewlineString(leading: string, trailing: string) {
        return leading.includes('\n') || /(?:\r?\n){2,}$/.test(trailing) ? (leading + trailing).includes('\r') ? '\r\n' : '\n' : '';
    }

    public errors: Error[] = [];
    public modifyCount = 0;

    constructor(public source: string, public elements: ElementIndex[]) {
    }

    startHTML() {
        let result = -1;
        new Parser(new DomHandler((err, dom) => {
            if (!err) {
                const html = domutils.findOne(elem => elem.tagName === 'html', dom);
                if (html) {
                    result = html.startIndex!;
                }
            }
            else {
                this.errors.push(err);
            }
        }, { withStartIndices: true, withEndIndices: true })).end(this.source);
        return result;
    }
    write(element: HtmlElement, options?: { remove?: boolean; decrement?: boolean }) {
        let remove: Undef<boolean>,
            decrement: Undef<boolean>;
        if (options) {
            ({ remove, decrement } = options);
        }
        const [output, replaceHTML] = element.write(this.source, remove);
        if (output) {
            const position = element.position;
            this.source = output;
            ++this.modifyCount;
            if (remove) {
                return this.decrement(position);
            }
            else if (decrement) {
                const tagName = element.tagName.toUpperCase();
                if (tagName !== position.tagName) {
                    const result = this.decrement(position, tagName);
                    this.rebuild(position, replaceHTML, true);
                    return result;
                }
            }
            this.rebuild(position, replaceHTML);
            return true;
        }
        return false;
    }
    rebuild(index: ElementIndex, replaceHTML: string, data?: true | { nodes: domhandler.Element[]; sourceIndex: number }) {
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
        if (data) {
            if (data !== true) {
                const previous = elements.filter(item => item.outerHTML === outerHTML);
                if (previous.length) {
                    const { nodes, sourceIndex } = data;
                    const matched: number[] = [];
                    const length = data.nodes.length;
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
    decrement(index: ElementIndex, tagName?: string) {
        const { tagName: tag, tagIndex, outerHTML, outerIndex, outerCount } = index;
        const updated: ElementIndex[] = [];
        for (const item of this.elements) {
            if (item.tagName === tag) {
                if (item.tagIndex === tagIndex) {
                    if (tagName) {
                        item.tagName = tagName;
                    }
                    item.tagIndex = -1;
                    item.tagCount = -1;
                    item.outerCount = 1;
                    item.outerIndex = 0;
                    updated.push(item);
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
        return tagName ? this.insertTag(tagName, updated) : true;
    }
    insertTag(tagName: string, updated: ElementIndex[] = []) {
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
                            for (let j = 0; j < updated.length; ++j) {
                                const item = updated[j];
                                if (item.startIndex === startIndex && item.endIndex === endIndex) {
                                    item.tagIndex = i;
                                    item.tagCount = tagCount.size;
                                    updated.splice(j--, 1);
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
                                    if (sourceHTML === item.outerHTML || !HtmlElement.hasContent(tag) && sourceHTML.replace(/\s*\/?>$/, '>') === item.outerHTML) {
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
            for (const item of updated) {
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
    hasErrors() {
        return this.errors.length > 0;
    }
}

export class HtmlElement {
    public static hasContent(tagName: string) {
        switch (tagName.toLowerCase()) {
            case 'area':
            case 'base':
            case 'br':
            case 'col':
            case 'embed':
            case 'hr':
            case 'img':
            case 'input':
            case 'link':
            case 'meta':
            case 'param':
            case 'source':
            case 'track':
            case 'wbr':
                return false;
            default:
                return true;
        }
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

    private _modified = false;
    private _tagStart: string;
    private _tagEnd: string;
    private _tagName = '';
    private _innerHTML: string;

    constructor(public position: ElementIndex, public attributes: StandardMap = {}) {
        for (const key in attributes) {
            const name = key.toLowerCase();
            if (name !== key) {
                const value = attributes[key];
                delete attributes[key];
                attributes[name] = value;
            }
        }
        const [opening, closing, content] = HtmlElement.splitOuterHTML(position.outerHTML);
        const hasValue = (name: string) => /^[a-z][a-z\d-:.]*$/.test(name) && !this.hasAttribute(name);
        let pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]*))/g,
            source = opening,
            match: Null<RegExpExecArray>;
        while (match = pattern.exec(opening)) {
            const attr = match[1].toLowerCase();
            if (hasValue(attr)) {
                attributes[attr] = match[2] || match[3] || match[4] || '';
            }
            source = source.replace(match[0], '');
        }
        pattern = /(<|\s+)([^\s="'/>]+)/g;
        while (match = pattern.exec(source)) {
            if (match[1][0] === '<' && position.tagName.toUpperCase() === match[2].toUpperCase()) {
                continue;
            }
            else {
                const attr = match[2].toLowerCase();
                if (hasValue(attr)) {
                    attributes[attr] = null;
                }
            }
        }
        this._tagStart = opening;
        this._tagEnd = closing;
        this._modified = Object.keys(attributes).length > 0;
        this._innerHTML = content;
    }
    setAttribute(name: string, value: string) {
        name = name.toLowerCase();
        const attrs = this.attributes;
        for (const key in attrs) {
            if (key === name) {
                delete attrs[key];
                break;
            }
        }
        attrs[name] = value;
        this._modified = true;
    }
    getAttribute(name: string): Undef<string> {
        return this.attributes[name.toLowerCase()];
    }
    removeAttribute(...names: string[]) {
        const attrs = this.attributes;
        for (const key in attrs) {
            if (names.includes(key)) {
                delete attrs[key];
                this._modified = true;
            }
        }
    }
    hasAttribute(name: string) {
        name = name.toLowerCase();
        for (const key in this.attributes) {
            if (key === name) {
                return true;
            }
        }
        return false;
    }
    write(source: string, remove?: boolean): [string, string] {
        if (this._modified || remove) {
            const { tagName, outerIndex, outerCount, outerHTML } = this.position;
            const replaceHTML = !remove ? this.outerHTML : '';
            const spliceSource = (index: [number, number, string]) => {
                const [startIndex, endIndex, trailing] = index;
                const content = replaceHTML + trailing;
                this.position.startIndex = startIndex;
                this.position.endIndex = startIndex + content.length - 1;
                return source.substring(0, startIndex) + content + source.substring(endIndex);
            };
            const foundIndex: [number, number, string][] = [];
            if (outerIndex !== -1) {
                let pattern = !HtmlElement.hasContent(tagName) ? escapeRegexp(outerHTML).replace(/\/?>$/, '\\s*/?>') : escapeRegexp(outerHTML),
                    match: Null<RegExpExecArray>;
                if (remove) {
                    pattern = '(\\s*)' + pattern + '[ \\t]*((?:\\r?\\n)*)';
                }
                const tag = new RegExp(pattern, 'g');
                while (match = tag.exec(source)) {
                    foundIndex.push([match.index, match.index + match[0].length, remove ? DomWriter.getNewlineString(match[1], match[2]) : '']);
                }
                if (foundIndex.length === outerCount) {
                    return [spliceSource(foundIndex[outerIndex]), replaceHTML];
                }
            }
            const { tagCount, tagIndex } = this.position;
            if (tagName === 'HTML') {
                const startIndex = this.position.startIndex;
                if (startIndex !== undefined && startIndex !== -1) {
                    const [opening, closing] = HtmlElement.splitOuterHTML(source, startIndex);
                    if (opening && closing) {
                        return [spliceSource([startIndex, startIndex + opening.length, '']), replaceHTML];
                    }
                }
                return ['', ''];
            }
            foundIndex.length = 0;
            const minHTML = DomWriter.minifySpace(outerHTML);
            let index: Undef<[number, number, string]>;
            if (this._tagStart && this._tagEnd) {
                const openTag: number[] = [];
                let tag = new RegExp(`<${escapeRegexp(tagName)}\\b`, 'ig'),
                    match: Null<RegExpExecArray>;
                while (match = tag.exec(source)) {
                    openTag.push(match.index);
                }
                const open = openTag.length;
                if (open) {
                    const closeTag: number[] = [];
                    tag = new RegExp(`</\\s*${escapeRegexp(tagName)}\\s*>`, 'ig');
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
                        const [startIndex, endIndex] = foundIndex[tagIndex];
                        if (minHTML === DomWriter.minifySpace(source.substring(startIndex, endIndex))) {
                            index = foundIndex[tagIndex];
                        }
                    }
                }
            }
            if (!index) {
                new Parser(new DomHandler((err, dom) => {
                    if (!err) {
                        const tagElem = tagName.toLowerCase();
                        const nodes = domutils.findAll(elem => elem.tagName === tagElem, dom);
                        if (nodes.length === tagCount) {
                            const { startIndex, endIndex } = nodes[tagIndex];
                            if (minHTML === DomWriter.minifySpace(source.substring(startIndex!, endIndex! + 1))) {
                                index = [startIndex!, endIndex! + 1, ''];
                            }
                        }
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
        return ['', ''];
    }
    set tagName(value: string) {
        if (value.toLowerCase() !== this.tagName.toLowerCase()) {
            this._tagName = value;
            if (!HtmlElement.hasContent(value)) {
                this.innerHTML = '';
            }
            this._modified = true;
        }
    }
    get tagName() {
        if (!this._tagName) {
            const match = /^<([^\s/>]+)/i.exec(this._tagStart);
            this._tagName = match ? match[1] : this.position.tagName.toLowerCase();
        }
        return this._tagName;
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
        const attrs = this.attributes;
        let outerHTML = '<' + tagName;
        for (const key in attrs) {
            const value = attrs[key] as Undef<string>;
            if (value !== undefined) {
                outerHTML += ' ' + key + (value !== null ? `="${value.replace(/"/g, '&quot;')}"` : '');
            }
        }
        return outerHTML + (!HtmlElement.hasContent(tagName) || tagName.toLowerCase() === 'html' ? '>' : '>' + this.innerHTML + `</${tagName}>`);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DomWriter, HtmlElement };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}