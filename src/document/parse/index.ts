import type { TagAppend } from '../../types/lib/squared';

import type { AttributeList, AttributeMap, IXmlElement, IXmlWriter, SaveResult, SourceContent, SourceIndex, WriteOptions, WriteResult, XmlTagNode } from './document';

import escapeRegexp = require('escape-string-regexp');
import uuid = require('uuid');

type WriteSourceIndex = [number, number, string?];

const REGEXP_ATTRNAME = /[^<]\s+([^\s=>]+)/g;
const REGEXP_ATTRVALUE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]*))/g;

function isSpace(ch: string) {
    const n = ch.charCodeAt(0);
    return n === 32 || n < 14 && n > 8;
}

function applyAttributes(attrs: AttributeMap, data: Undef<StandardMap>, lowerCase?: boolean) {
    if (data) {
        for (const key in data) {
            attrs.set(lowerCase ? key.toLowerCase() : key, data[key]);
        }
    }
}

function deleteStartIndex(item: XmlTagNode, rootName: Undef<string>) {
    if (item.tagName !== rootName) {
        delete item.startIndex;
        delete item.endIndex;
    }
}

function resetTagIndex(item: XmlTagNode) {
    item.tagIndex = -1;
    item.tagCount = 0;
}

const isNode = (item: XmlTagNode, index: Undef<number>, tagIndex: Undef<number>, tagCount: Undef<number>, id: Undef<string>, documentName: string) => item.index === index && isIndex(index) || id && id === XmlWriter.getNodeId(item, documentName) || item.tagIndex === tagIndex && isIndex(tagIndex) && item.tagCount === tagCount && isCount(tagCount);
const isIndex = (value: Undef<unknown>): value is number => typeof value === 'number' && value >= 0 && value !== Infinity;
const isCount = (value: Undef<unknown>): value is number => typeof value === 'number' && value > 0 && value !== Infinity;

export abstract class XmlWriter implements IXmlWriter {
    static escapeXmlString(value: string) {
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

    static getNewlineString(leading: string, trailing: string, newline?: string) {
        return leading.includes('\n') || /(?:\r?\n){2,}$/.test(trailing) ? newline || ((leading + trailing).includes('\r') ? '\r\n' : '\n') : '';
    }

    static findCloseTag(source: string, startIndex = 0) {
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
                        default:
                            while (!isSpace(source[++i])) {
                                if (source[i] === '>') {
                                    return i;
                                }
                            }
                            break;
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

    static getNodeId(node: XmlTagNode, document: string) {
        return node.id?.[document] || '';
    }

    modifyCount = 0;
    failCount = 0;
    errors: Error[] = [];
    newline = '\n';
    readonly rootName?: string;

    protected _tagCount: ObjectMap<number> = {};

    constructor(
        public documentName: string,
        public source: string,
        public elements: XmlTagNode[])
    {
    }

    abstract newElement(node: XmlTagNode): IXmlElement;

    abstract get nameOfId(): string;

    init() {
        const appending: XmlTagNode[] = [];
        for (const item of this.elements) {
            if (item.append) {
                appending.push(item);
            }
            if (isCount(item.tagCount)) {
                this._tagCount[item.tagName] = item.tagCount;
            }
            deleteStartIndex(item, this.rootName);
        }
        if (appending.length) {
            this.insertNodes(appending);
        }
    }
    insertNodes(nodes: XmlTagNode[]) {
        nodes.sort((a, b) => {
            if (!isIndex(a.index) || !isIndex(b.index)) {
                return 0;
            }
            if (a.index === b.index) {
                const itemA = a.append;
                const itemB = b.append;
                if (itemA && itemB) {
                    const prependA = itemA.prepend;
                    const prependB = itemB.prepend;
                    if (prependA && prependB) {
                        return itemA.order - itemB.order;
                    }
                    else if (!prependA && !prependB) {
                        return itemB.order - itemA.order;
                    }
                    else if (prependA || !prependB) {
                        return 1;
                    }
                    else if (!prependA || prependB) {
                        return -1;
                    }
                }
            }
            return b.index - a.index;
        })
        .forEach(item => this.append(item));
    }
    fromNode(node: XmlTagNode, append?: TagAppend) {
        const element = this.newElement(node);
        if (append) {
            const tagName = append.tagName;
            if (!(tagName in this._tagCount) && isCount(append.tagCount)) {
                this._tagCount[tagName] = append.tagCount;
            }
            append.id ||= this.newId;
        }
        return element;
    }
    append(node: XmlTagNode) {
        const append = node.append;
        if (append) {
            const element = this.fromNode(node, append);
            const index = this.elements.findIndex(item => item === node);
            if (this.write(element, { append })) {
                if (index === -1) {
                    this.elements.push(node);
                }
                delete node.append;
                return element;
            }
            if (index !== -1) {
                this.elements.splice(index, 1);
            }
            this.errors.push(new Error(`Unable to ${append.prepend ? 'prepend' : 'append'} element ` + append.tagName.toUpperCase() + (isIndex(node.index) ? ` at index ${node.index}` : '')));
        }
        return null;
    }
    write(element: IXmlElement, options?: WriteOptions) {
        let remove: Undef<boolean>,
            rename: Undef<boolean>,
            append: Undef<TagAppend>;
        if (options) {
            ({ remove, rename, append } = options);
        }
        element.newline = this.newline;
        let output: Undef<string>,
            outerXml = '',
            error: Optional<Error> = null;
        if (!remove && !append) {
            if (!element.modified) {
                return true;
            }
            if (element.id && element.tagName !== this.rootName) {
                const content = this.getOuterXmlById(element.id, !element.node.lowerCase);
                if (content && content.tagName === element.tagName) {
                    content.outerXml = remove ? '' : element.outerXml;
                    output = this.spliceRawString(content);
                    outerXml = content.outerXml;
                }
            }
        }
        if (!output) {
            [output, outerXml, error] = element.write(this.source, options);
            if (output) {
                this.source = output;
                ++this.modifyCount;
            }
        }
        if (output) {
            const node = element.node;
            if (append) {
                if (!append.prepend && isIndex(node.index)) {
                    ++node.index;
                }
                const { id = '', tagName } = append;
                node.outerXml = outerXml;
                (node.id ||= {})[this.documentName] = id;
                element.id = id;
                if (tagName !== node.tagName) {
                    node.tagName = tagName;
                    node.tagIndex = Infinity;
                    node.tagCount = 0;
                    this.increment(node);
                    error = this.indexTag(tagName, true);
                }
                else {
                    if (!append.prepend && isIndex(node.tagIndex) && isCount(node.tagCount)) {
                        ++node.tagIndex;
                        ++node.tagCount;
                    }
                    this.increment(node);
                }
            }
            else if (remove) {
                this.decrement(node, true);
            }
            else if (rename && element.tagName !== node.tagName) {
                error = this.renameTag(node, element.tagName);
            }
            this.update(node, outerXml);
        }
        if (error) {
            ++this.failCount;
            this.errors.push(error);
            return false;
        }
        return true;
    }
    save() {
        for (const item of this.elements) {
            deleteStartIndex(item, this.rootName);
        }
        this.modifyCount = 0;
        return this.source;
    }
    update(node: XmlTagNode, outerXml: string) {
        const { tagName, tagIndex, tagCount, index, startIndex, endIndex } = node;
        const { elements, documentName, rootName } = this;
        const id = XmlWriter.getNodeId(node, documentName);
        for (let i = 0; i < elements.length; ++i) {
            const item = elements[i];
            if (item.tagName === tagName && isNode(item, index, tagIndex, tagCount, id, documentName)) {
                if (outerXml) {
                    item.outerXml = outerXml;
                    if (isIndex(startIndex) && isIndex(endIndex)) {
                        item.startIndex = startIndex;
                        item.endIndex = endIndex;
                    }
                    else {
                        deleteStartIndex(item, rootName);
                    }
                }
                else {
                    elements.splice(i--, 1);
                }
            }
            else if (item.tagName !== rootName && (!isIndex(startIndex) || isIndex(item.startIndex) && item.startIndex >= startIndex)) {
                deleteStartIndex(item, rootName);
            }
        }
    }
    increment(node: XmlTagNode) {
        const { index, tagName, tagIndex } = node;
        let invalid: Undef<boolean>;
        for (const item of this.elements) {
            if (item !== node) {
                if (!invalid && item.tagName === tagName) {
                    if (isIndex(tagIndex) && isIndex(item.tagIndex) && isCount(item.tagCount)) {
                        if (item.tagIndex >= tagIndex) {
                            ++item.tagIndex;
                        }
                        ++item.tagCount;
                    }
                    else {
                        invalid = true;
                    }
                }
                if (isIndex(item.index) && isIndex(index) && item.index >= index) {
                    ++item.index;
                }
            }
        }
        if (invalid) {
            this.resetTag(tagName);
            delete this._tagCount[tagName];
        }
        else if (tagName in this._tagCount) {
            --this._tagCount[tagName];
        }
    }
    decrement(node: XmlTagNode, remove?: boolean) {
        const { index, tagName, tagIndex, tagCount } = node;
        const id = XmlWriter.getNodeId(node, this.documentName);
        const hasIndex = isIndex(tagIndex) && isCount(tagCount);
        const result: XmlTagNode[] = [];
        const elements = this.elements;
        let invalid: Undef<boolean>;
        for (let i = 0; i < elements.length; ++i) {
            const item = elements[i];
            if (!invalid && item.tagName === tagName) {
                if (isNode(item, index, tagIndex, tagCount, id, this.documentName)) {
                    if (remove) {
                        elements.splice(i--, 1);
                        continue;
                    }
                    else {
                        result.push(item);
                    }
                }
                else if (hasIndex && isIndex(item.tagIndex) && isCount(item.tagCount)) {
                    if (item.tagIndex > tagIndex!) {
                        --item.tagIndex;
                    }
                    --item.tagCount;
                }
                else {
                    invalid = true;
                }
            }
            if (remove && isIndex(item.index) && isIndex(index) && item.index > index) {
                --item.index;
            }
        }
        if (invalid) {
            this.resetTag(tagName);
            delete this._tagCount[tagName];
            return [];
        }
        if (tagName in this._tagCount) {
            --this._tagCount[tagName];
        }
        return result;
    }
    renameTag(node: XmlTagNode, tagName: string) {
        const revised = this.decrement(node);
        if (revised.includes(node)) {
            for (const item of revised) {
                item.tagName = tagName;
                item.tagIndex = Infinity;
            }
            if (tagName in this._tagCount) {
                ++this._tagCount[tagName];
                return this.indexTag(tagName);
            }
        }
        else {
            node.tagName = tagName;
            resetTagIndex(node);
        }
        return null;
    }
    indexTag(tagName: string, append?: boolean) {
        if (tagName in this._tagCount) {
            const elements: XmlTagNode[] = [];
            const revised: XmlTagNode[] = [];
            const index = new Set<number>();
            let documentIndex = -1;
            for (const item of this.elements) {
                if (item.tagName === tagName) {
                    if (isIndex(item.index)) {
                        if (item.tagIndex === Infinity) {
                            documentIndex = item.index;
                            revised.push(item);
                            index.add(-1);
                            continue;
                        }
                        else if (isIndex(item.tagIndex)) {
                            elements.push(item);
                            index.add(item.tagIndex);
                            continue;
                        }
                    }
                    documentIndex = Infinity;
                    break;
                }
            }
            if (documentIndex === Infinity) {
                this.resetTag(tagName);
            }
            else {
                const tagCount = this._tagCount[tagName];
                if (append && tagCount === 1) {
                    if (!elements.length) {
                        for (const item of revised) {
                            item.tagIndex = 0;
                            item.tagCount = 1;
                        }
                        return null;
                    }
                }
                else if (index.size === tagCount) {
                    if (documentIndex !== -1) {
                        let i = tagCount - 1;
                        index.clear();
                        for (const item of elements) {
                            if (item.index! > documentIndex) {
                                ++item.tagIndex!;
                            }
                            index.add(item.tagIndex!);
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
                    return null;
                }
            }
            return new Error(`Warning: Unable to index ${tagName.toUpperCase()}`);
        }
        return null;
    }
    resetTag(tagName: string) {
        for (const item of this.elements) {
            if (item.tagName === tagName) {
                resetTagIndex(item);
            }
        }
    }
    close() {
        const source = this.source;
        this.source = '';
        this.elements.length = 0;
        return source;
    }
    getOuterXmlById(id: string, caseSensitive = true) {
        const source = this.source;
        let match = new RegExp(`<([^\\s>]+)(?:[^=>]|=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)|=)+?${escapeRegexp(this.nameOfId)}="${escapeRegexp(id)}"`).exec(source);
        if (match) {
            let endIndex = -1,
                openTag = 1,
                closeTag = 0;
            const startIndex = match.index;
            const tagName = match[1];
            const pattern = new RegExp(`(?:(<${escapeRegexp(tagName)}\\b)|(</${escapeRegexp(tagName)}\\s*>))`, caseSensitive ? 'g' : 'gi');
            pattern.lastIndex = startIndex + match[0].length;
            while (match = pattern.exec(source)) {
                if (match[1]) {
                    ++openTag;
                }
                else if (openTag === ++closeTag) {
                    endIndex = match.index + match[0].length - 1;
                    break;
                }
            }
            if (closeTag === 0) {
                endIndex = XmlWriter.findCloseTag(source, startIndex);
            }
            if (endIndex !== -1) {
                return { tagName, outerXml: source.substring(startIndex, endIndex + 1), startIndex, endIndex } as Required<SourceContent>;
            }
        }
    }
    setRawString(targetXml: string, outerXml: string) {
        const source = this.source.replace(targetXml, outerXml);
        if (source !== this.source) {
            ++this.modifyCount;
            this.source = source;
            return true;
        }
        return false;
    }
    getRawString(index: SourceIndex) {
        const { startIndex, endIndex } = index;
        return this.source.substring(startIndex, endIndex + 1);
    }
    spliceRawString(content: SourceContent) {
        const { startIndex, endIndex, outerXml } = content;
        ++this.modifyCount;
        return this.source = this.source.substring(0, startIndex) + outerXml + this.source.substring(endIndex + 1);
    }
    hasErrors() {
        return this.errors.length > 0;
    }
    get newId() {
        return uuid.v4();
    }
    get modified() {
        return this.modifyCount > 0;
    }
}

export abstract class XmlElement implements IXmlElement {
    static writeAttributes(attrs: AttributeMap | AttributeList, escapeEntities?: boolean) {
        let result = '';
        for (const [key, value] of attrs) {
            if (value !== undefined) {
                result += ' ' + key + (value !== null ? `="${escapeEntities ? XmlWriter.escapeXmlString(value) : value.replace(/"/g, '&quot;')}"` : '');
            }
        }
        return result;
    }

    newline = '\n';

    protected _modified = false;
    protected _tagName = '';
    protected _innerXml = '';
    protected readonly _attributes = new Map<string, Optional<string>>();

    abstract readonly TAG_VOID: string[];

    constructor(
        public readonly documentName: string,
        public readonly node: XmlTagNode,
        attributes?: StandardMap,
        public tagVoid = false)
    {
        const lowerCase = node.lowerCase;
        const attrs = this._attributes;
        applyAttributes(attrs, node.attributes, lowerCase);
        applyAttributes(attrs, attributes, lowerCase);
        this._modified = attrs.size > 0;
        if (node.outerXml) {
            const [tagStart, innerXml] = this.parseOuterXml(node.outerXml);
            if (tagStart) {
                REGEXP_ATTRVALUE.lastIndex = 0;
                REGEXP_ATTRNAME.lastIndex = 0;
                let source = tagStart,
                    match: Null<RegExpExecArray>;
                while (match = REGEXP_ATTRVALUE.exec(tagStart)) {
                    const attr = lowerCase ? match[1].toLowerCase() : match[1];
                    if (!attrs.has(attr)) {
                        attrs.set(attr, match[2] || match[3] || match[4] || '');
                    }
                    source = source.replace(match[0], '');
                }
                while (match = REGEXP_ATTRNAME.exec(source)) {
                    const attr = lowerCase ? match[1].toLowerCase() : match[1];
                    if (!attrs.has(attr)) {
                        attrs.set(attr, null);
                    }
                }
                this._innerXml = innerXml;
            }
        }
        else if (node.innerXml) {
            this._innerXml = node.innerXml;
        }
    }

    abstract findIndexOf(source: string): Undef<SourceIndex>;

    abstract set id(value: string);
    abstract get id(): string;
    abstract get outerXml(): string;
    abstract get nameOfId(): string;

    parseOuterXml(outerXml = this.node.outerXml): [string, string] {
        let tagStart: Undef<string>,
            innerXml: Undef<string>;
        if (outerXml) {
            const endIndex = XmlWriter.findCloseTag(outerXml) + 1;
            if (endIndex !== 0) {
                if (this.tagVoid) {
                    return [endIndex === outerXml.length ? outerXml : outerXml.substring(0, endIndex), ''];
                }
                tagStart = outerXml.substring(0, endIndex);
                const lastIndex = outerXml.lastIndexOf('<');
                if (endIndex < lastIndex) {
                    innerXml = outerXml.substring(endIndex, lastIndex);
                }
            }
        }
        return [tagStart || `<${this.tagName}>`, innerXml || ''];
    }
    setAttribute(name: string, value: string) {
        if (this.node.lowerCase) {
            name = name.toLowerCase();
        }
        if (this._attributes.get(name) !== value) {
            this._attributes.set(name, value);
            this._modified = true;
        }
    }
    getAttribute(name: string) {
        return this._attributes.get(this.node.lowerCase ? name.toLowerCase() : name);
    }
    removeAttribute(...names: string[]) {
        const lowerCase = this.node.lowerCase;
        const attrs = this._attributes;
        for (let key of names) {
            if (lowerCase) {
                key = key.toLowerCase();
            }
            if (attrs.has(key)) {
                attrs.delete(key);
                this._modified = true;
            }
        }
    }
    hasAttribute(name: string) {
        return this._attributes.has(this.node.lowerCase ? name.toLowerCase() : name);
    }
    write(source: string, options?: WriteOptions): WriteResult {
        let remove: Undef<boolean>,
            append: Undef<TagAppend>;
        if (options) {
            ({ remove, append } = options);
        }
        if (this._modified || remove || append) {
            const { id, node } = this;
            const outerXml = remove ? '' : this.outerXml;
            const spliceSource = (startIndex: number, endIndex: number, trailing = '') => {
                let leading = '';
                if (append) {
                    let newline: Undef<boolean>,
                        i = startIndex - 1;
                    while (isSpace(source[i])) {
                        if (source[i] === '\n') {
                            newline = true;
                            break;
                        }
                        leading = source[i--] + leading;
                    }
                    trailing = this.newline;
                    if (!append.prepend) {
                        endIndex += 2;
                        startIndex = endIndex;
                        if (!newline) {
                            leading = this.newline + leading;
                        }
                    }
                    else {
                        trailing += leading;
                        endIndex = startIndex;
                        leading = '';
                    }
                }
                else {
                    ++endIndex;
                }
                if (!remove) {
                    node.startIndex = startIndex + leading.length;
                    node.endIndex = node.startIndex + outerXml.length - 1;
                }
                return source.substring(0, startIndex) + leading + outerXml + trailing + source.substring(endIndex);
            };
            if (isIndex(node.startIndex) && isIndex(node.endIndex)) {
                return [spliceSource(node.startIndex, node.endIndex), outerXml];
            }
            const { tagName, tagIndex = -1, tagCount = Infinity, lowerCase } = node;
            const errorResult = (message: string): [string, string, Error] => ['', '', new Error(`${tagName.toUpperCase()} ${tagIndex}: ${message}`)];
            if (append && !id) {
                return errorResult('Element id is missing.');
            }
            const tagVoid = this.TAG_VOID.includes(tagName);
            const voidId = tagVoid && !!id;
            const onlyId = !isIndex(tagIndex) || !!append;
            const openTag: number[] = [];
            const hasId = (start: number, end?: number) => !!id && source.substring(start, end).includes(id);
            const getTagStart = (start: number, checkId?: boolean, end = XmlWriter.findCloseTag(source, start)) => end !== -1 && (!checkId || hasId(start, end)) ? [spliceSource(start, end), outerXml] as WriteResult : null;
            let tag = new RegExp(`<${escapeRegexp(tagName)}[\\s|>]`, lowerCase ? 'gi' : 'g'),
                openCount = 0,
                result: Null<WriteResult>,
                match: Null<RegExpExecArray>;
            while (match = tag.exec(source)) {
                const index = match.index;
                const end = XmlWriter.findCloseTag(source, index);
                if (end !== -1) {
                    if (voidId && (openCount === tagIndex || onlyId) && (result = getTagStart(index, true, end))) {
                        return result;
                    }
                    openCount = openTag.push(index);
                    tag.lastIndex = end;
                }
                else {
                    break;
                }
            }
            let sourceIndex: Undef<WriteSourceIndex>;
            if (tagVoid) {
                if (openCount === tagCount && (result = getTagStart(openTag[tagIndex]))) {
                    return result;
                }
            }
            else if (id || isCount(tagCount)) {
                complete: {
                    const closeTag: number[] = [];
                    const foundIndex: WriteSourceIndex[] = [];
                    let foundCount = 0;
                    tag = new RegExp(`</${escapeRegexp(tagName)}\\s*>`, lowerCase ? 'gi' : 'g');
                    while (match = tag.exec(source)) {
                        closeTag.push(match.index + match[0].length - 1);
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
                                const next: WriteSourceIndex = [openTag[i], closeTag[j]];
                                if (id) {
                                    if (foundCount === tagCount - 1 && hasId(openTag[i])) {
                                        sourceIndex = next;
                                        break complete;
                                    }
                                    else {
                                        let index: Undef<WriteSourceIndex>;
                                        if (append || tagIndex === -1) {
                                            if (foundCount) {
                                                index = foundIndex[foundCount - 1];
                                            }
                                        }
                                        else if (foundCount === tagIndex + 1) {
                                            index = foundIndex[tagIndex];
                                        }
                                        if (index && hasId(index[0], openTag[i])) {
                                            sourceIndex = index;
                                            break complete;
                                        }
                                    }
                                }
                                foundCount = foundIndex.push(next);
                            }
                            else if (!id && openCount <= tagCount) {
                                break complete;
                            }
                        }
                    }
                    if (append) {
                        sourceIndex = foundIndex[foundCount - 1];
                        if (!hasId(sourceIndex[0], sourceIndex[1])) {
                            return errorResult(`Element ${id} was not found.`);
                        }
                    }
                    else if (foundCount === tagCount) {
                        sourceIndex = foundIndex[tagIndex];
                    }
                }
            }
            if (!sourceIndex) {
                const found = this.findIndexOf(source);
                if (found) {
                    sourceIndex = [found.startIndex, found.endIndex];
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
                    sourceIndex[2] = XmlWriter.getNewlineString(leading, trailing, this.newline);
                }
                return [spliceSource(...sourceIndex), outerXml];
            }
        }
        return ['', ''];
    }
    save(source: string, options?: WriteOptions): SaveResult {
        const [output, outerXml, error] = this.write(source, options);
        if (output) {
            this.node.outerXml = outerXml;
            this._modified = false;
        }
        return [output, error];
    }
    protected getContent(escapeTags?: string[]): [string, AttributeMap | AttributeList, Undef<string>] {
        const append = this.node.append;
        let tagName: Undef<string>,
            items: AttributeMap | AttributeList,
            textContent: Undef<string>;
        if (append) {
            let id: Undef<string>;
            ({ tagName, textContent, id } = append);
            const idKey = this.nameOfId;
            items = Array.from(this._attributes).filter(item => item[0] !== idKey);
            if (id) {
                items.push([idKey, id]);
            }
        }
        else {
            tagName = this.tagName;
            items = this._attributes;
        }
        if (textContent && escapeTags && !escapeTags.includes(tagName)) {
            textContent = XmlWriter.escapeXmlString(textContent);
        }
        return [tagName, items, textContent];
    }
    set tagName(value: string) {
        if (value !== this.tagName) {
            this._tagName = value;
            if (this.TAG_VOID.includes(value)) {
                this.tagVoid = true;
                this.innerXml = '';
            }
            else {
                this.tagVoid = false;
            }
            this._modified = true;
        }
    }
    get tagName() {
        return this._tagName || this.node.tagName;
    }
    set innerXml(value) {
        if (value !== this._innerXml) {
            this._innerXml = value;
            this._modified = true;
        }
    }
    get innerXml() {
        return this._innerXml;
    }
    get modified() {
        return this._modified;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { XmlWriter, XmlElement };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}