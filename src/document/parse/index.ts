import type { TagAppend } from '../../types/lib/squared';

import type { AttributeList, AttributeMap, IXmlElement, IXmlWriter, OuterXmlByIdOptions, ReplaceOptions, SaveResult, SourceContent, SourceIndex, SourceTagNode, TagOffsetMap, WriteOptions, WriteResult, XmlTagNode } from './document';

import uuid = require('uuid');
import htmlparser2 = require('htmlparser2');

import Module from '../../module';

const Parser = htmlparser2.Parser;

const PATTERN_ATTRNAME = '([^\\s=>]+)';
const PATTERN_ATTRVALUE = `=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]*))`;
const REGEXP_ATTRNAME = new RegExp('\\s+' + PATTERN_ATTRNAME, 'g');
const REGEXP_ATTRVALUE = new RegExp(PATTERN_ATTRNAME + '\\s*' + PATTERN_ATTRVALUE, 'g');

function isSpace(ch: string) {
    const n = ch.charCodeAt(0);
    return n === 32 || n < 14 && n > 8;
}

function applyAttributes(attrs: AttributeMap, data: Undef<StandardMap>, lowerCase: boolean) {
    if (data) {
        for (const key in data) {
            attrs.set(lowerCase ? key.toLowerCase() : key, data[key]);
        }
    }
}

function deletePosition(item: XmlTagNode, rootName: Undef<string>, startIndex?: number) {
    if (isIndex(item.startIndex) && (!isIndex(startIndex) || item.startIndex >= startIndex) && item.tagName !== rootName) {
        delete item.startIndex;
        delete item.endIndex;
    }
}

function updateTagName(item: XmlTagNode, tagName: string) {
    item.tagName = tagName;
    item.tagIndex = Infinity;
    item.tagCount = 0;
}

function resetTagPosition(item: XmlTagNode) {
    item.tagIndex = -1;
    item.tagCount = 0;
}

const isNode = (item: XmlTagNode, index: Undef<number>, tagIndex: Undef<number>, tagCount: Undef<number>, id: Undef<string>, documentName: string) => item.index === index && isIndex(index) || id && id === XmlWriter.getNodeId(item, documentName) || item.tagIndex === tagIndex && isIndex(tagIndex) && item.tagCount === tagCount && isCount(tagCount);
const isIndex = (value: Undef<unknown>): value is number => typeof value === 'number' && value >= 0 && value !== Infinity;
const isCount = (value: Undef<unknown>): value is number => typeof value === 'number' && value > 0 && value !== Infinity;

export abstract class XmlWriter implements IXmlWriter {
    static readonly PATTERN_ATTRNAME = PATTERN_ATTRNAME;
    static readonly PATTERN_ATTRVALUE = PATTERN_ATTRVALUE;
    static readonly PATTERN_TAGOPEN = `(?:[^=>]|${PATTERN_ATTRVALUE})`;
    static readonly PATTERN_TRAILINGSPACE = '[ \\t]*((?:\\r?\\n)*)';

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

    static getTagOffset(source: string, sourceNext?: string) {
        const result: TagOffsetMap = {};
        new Parser({
            onopentag(name) {
                result[name] = (result[name] || 0) + 1;
            }
        }).end(source);
        if (typeof sourceNext === 'string') {
            const next = sourceNext ? this.getTagOffset(sourceNext) : {};
            let revised: Undef<boolean>;
            for (const tagName of new Set([...Object.keys(result), ...Object.keys(next)])) {
                if (result[tagName] !== next[tagName]) {
                    result[tagName] = (next[tagName] || 0) - (result[tagName] || 0);
                    revised = true;
                }
            }
            if (!revised) {
                return {};
            }
        }
        return result;
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

    init(offsetMap?: TagOffsetMap) {
        const appending: XmlTagNode[] = [];
        for (const item of this.elements) {
            if (item.append) {
                appending.push(item);
            }
            if (isCount(item.tagCount)) {
                const tagName = item.tagName;
                item.tagCount += offsetMap?.[tagName] || 0;
                this._tagCount[tagName] = item.tagCount;
            }
            deletePosition(item, this.rootName);
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
            if (this.write(element, { append })) {
                delete node.append;
                return element;
            }
            const index = this.elements.findIndex(item => item === node);
            if (index !== -1) {
                this.elements.splice(index, 1);
            }
            this.errors.push(new Error(`Unable to ${append.prepend ? 'prepend' : 'append'} element ` + append.tagName.toUpperCase() + (isIndex(node.index) ? ` at index ${node.index}` : '')));
        }
        return null;
    }
    write(element: IXmlElement, options?: WriteOptions) {
        let append: Undef<TagAppend>;
        if (options) {
            ({ append } = options);
        }
        if (!element.modified && !append) {
            return true;
        }
        const { node, remove } = element;
        const getReplaceOptions = (position: SourceIndex): ReplaceOptions => ({ startIndex: position.startIndex, endIndex: position.endIndex, append, remove });
        let output: Undef<string>,
            outerXml = '',
            error: Optional<Error>;
        element.newline = this.newline;
        if (element.hasPosition()) {
            [output, outerXml] = element.replace(this.source, getReplaceOptions(node as SourceIndex));
        }
        else if (element.tagName !== this.rootName) {
            [output, outerXml, error] = element.write(this.source, options);
        }
        else {
            error = new Error('Root source position not found');
        }
        if (output) {
            this.source = output;
            if (!this.elements.includes(node)) {
                this.elements.push(node);
            }
            const tagOffset = element.tagOffset;
            if (append) {
                const { id = '', tagName, prepend, nextSibling } = append;
                if (!prepend) {
                    node.index = nextSibling ?? -1;
                }
                (node.id ||= {})[this.documentName] = id;
                element.id = id;
                const offset = tagOffset && tagOffset[tagName];
                if (tagName !== node.tagName) {
                    updateTagName(node, tagName);
                    this.indexTag(tagName, append, offset);
                }
                else if (!prepend && isIndex(node.tagIndex) && isCount(node.tagCount)) {
                    ++node.tagIndex;
                    ++node.tagCount;
                }
                this.increment([node], offset);
            }
            else if (remove) {
                this.decrement(node, tagOffset && tagOffset[element.tagName], true);
            }
            else if (element.tagName !== node.tagName) {
                this.renameTag(node, element.tagName);
            }
            this.update(node, outerXml, append, tagOffset);
            element.reset();
            ++this.modifyCount;
            return true;
        }
        if (error) {
            this.errors.push(error);
        }
        ++this.failCount;
        return false;
    }
    save() {
        this.reset();
        return this.source;
    }
    update(node: XmlTagNode, outerXml: string, append?: TagAppend, offsetMap?: TagOffsetMap) {
        const { elements, documentName, rootName } = this;
        const { index, tagName, tagIndex, tagCount, startIndex, endIndex } = node;
        const id = XmlWriter.getNodeId(node, documentName);
        const items: [boolean, Undef<number>, TagAppend][] = [];
        for (let i = 0; i < elements.length; ++i) {
            const item = elements[i];
            if (item === node || item.tagName === tagName && isNode(item, index, tagIndex, tagCount, id, documentName)) {
                if (outerXml) {
                    item.outerXml = outerXml;
                    if (isIndex(startIndex) && isIndex(endIndex)) {
                        item.startIndex = startIndex;
                        item.endIndex = endIndex;
                    }
                    else {
                        deletePosition(item, rootName);
                    }
                }
                else {
                    item.removed = true;
                    elements.splice(i--, 1);
                    continue;
                }
            }
            else {
                deletePosition(item, rootName, startIndex);
            }
            if (offsetMap && item.append) {
                items.push([true, item.index, item.append]);
            }
        }
        if (offsetMap) {
            items.push(...elements.map(item => [false, item.index, item]) as [boolean, Undef<number>, TagAppend][]);
            for (const name in offsetMap) {
                const offset = offsetMap[name];
                if (offset) {
                    const updated = !!append && tagName === name;
                    let offsetCount = -1;
                    for (const [appended, itemIndex, item] of items) {
                        if (item.tagName === name) {
                            if (isIndex(index) && isIndex(itemIndex) && isCount(item.tagCount)) {
                                if (appended) {
                                    if (updated) {
                                        item.tagCount = this._tagCount[name];
                                    }
                                    else {
                                        item.tagCount += offset;
                                    }
                                }
                                else if (isIndex(item.tagIndex)) {
                                    if (!updated) {
                                        if (itemIndex > index) {
                                            item.tagIndex += offset;
                                        }
                                        item.tagCount += offset;
                                    }
                                }
                                else {
                                    offsetCount = Infinity;
                                }
                                if (offsetCount === -1) {
                                    offsetCount = item.tagCount;
                                    continue;
                                }
                                else if (offsetCount === item.tagCount) {
                                    continue;
                                }
                            }
                            offsetCount = -1;
                            this.resetTag(name);
                            break;
                        }
                    }
                    if (offsetCount !== -1) {
                        this._tagCount[name] = offsetCount;
                    }
                }
            }
        }
    }
    increment(nodes: XmlTagNode[], offset = 0) {
        const { index, tagName, tagIndex } = nodes[0];
        let invalid: Undef<boolean>;
        ++offset;
        for (const item of this.elements) {
            if (!nodes.includes(item)) {
                if (!invalid && item.tagName === tagName) {
                    if (isIndex(tagIndex) && isIndex(item.tagIndex) && isCount(item.tagCount)) {
                        if (item.tagIndex >= tagIndex) {
                            item.tagIndex += offset;
                        }
                        item.tagCount += offset;
                    }
                    else {
                        invalid = true;
                    }
                }
                if (isIndex(item.index)) {
                    if (!isIndex(index)) {
                        item.index = -1;
                    }
                    else {
                        if (item.index >= index) {
                            ++item.index;
                        }
                        if (item.append) {
                            const nextSibling = item.append.nextSibling;
                            if (isIndex(nextSibling) && nextSibling >= index) {
                                item.append.nextSibling! = nextSibling + 1;
                            }
                        }
                    }
                }
            }
        }
        if (invalid) {
            this.resetTag(tagName);
        }
        else if (tagName in this._tagCount) {
            this._tagCount[tagName] += offset;
        }
    }
    decrement(node: XmlTagNode, offset = 0, remove?: boolean) {
        const { elements, documentName } = this;
        const { index, tagName, tagIndex, tagCount } = node;
        const id = XmlWriter.getNodeId(node, documentName);
        const hasIndex = isIndex(tagIndex) && isCount(tagCount);
        const result: XmlTagNode[] = [];
        ++offset;
        for (let i = 0; i < elements.length; ++i) {
            const item = elements[i];
            if (item.tagName === tagName) {
                if (item === node || isNode(item, index, tagIndex, tagCount, id, documentName)) {
                    if (remove) {
                        item.removed = true;
                        elements.splice(i--, 1);
                    }
                    else {
                        result.push(item);
                    }
                }
                else if (hasIndex && isIndex(item.tagIndex) && isCount(item.tagCount)) {
                    if (item.tagIndex > tagIndex!) {
                        item.tagIndex -= offset;
                    }
                    item.tagCount -= offset;
                }
                else {
                    this.resetTag(tagName);
                    return [];
                }
            }
        }
        if (tagName in this._tagCount) {
            this._tagCount[tagName] -= offset;
        }
        return result;
    }
    renameTag(node: XmlTagNode, tagName: string) {
        const revised = this.decrement(node);
        if (revised.includes(node)) {
            if (tagName in this._tagCount) {
                for (const item of revised) {
                    updateTagName(item, tagName);
                }
                this.indexTag(tagName);
                this.increment(revised);
            }
            else {
                this.resetTag(tagName);
            }
        }
        else {
            node.tagName = tagName;
            resetTagPosition(node);
        }
    }
    indexTag(tagName: string, append?: TagAppend, offset = 0) {
        if (tagName in this._tagCount) {
            const elements: XmlTagNode[] = [];
            const revised: XmlTagNode[] = [];
            const indexMap = new Set<number>();
            let documentIndex = -1,
                minIndex = Infinity,
                maxIndex = -1;
            for (const item of this.elements) {
                if (item.tagName === tagName) {
                    const index = item.index;
                    if (isIndex(index)) {
                        const tagIndex = item.tagIndex;
                        if (tagIndex === Infinity) {
                            documentIndex = index;
                            revised.push(item);
                            indexMap.add(-1);
                            continue;
                        }
                        else if (isIndex(tagIndex)) {
                            elements.push(item);
                            indexMap.add(tagIndex);
                            minIndex = Math.min(minIndex, index);
                            maxIndex = Math.max(maxIndex, index);
                            continue;
                        }
                    }
                    this.resetTag(tagName);
                    return;
                }
            }
            if (revised.length) {
                const tagCount = this._tagCount[tagName];
                if (!elements.length) {
                    if (append && !tagCount) {
                        for (const item of revised) {
                            item.tagIndex = 0;
                            item.tagCount = 1;
                        }
                        this._tagCount[tagName] = 1;
                        return;
                    }
                }
                else if (documentIndex < minIndex) {
                    if (elements.some(item => item.tagIndex === 0)) {
                        for (const item of revised) {
                            item.tagIndex = 0;
                            item.tagCount = tagCount + offset + 1;
                        }
                        return;
                    }
                }
                else if (documentIndex > maxIndex) {
                    if (elements.some(item => item.tagIndex === tagCount - 1)) {
                        for (const item of revised) {
                            item.tagIndex = tagCount;
                            item.tagCount = tagCount + offset + 1;
                        }
                        return;
                    }
                }
                else if (indexMap.size === tagCount + 1) {
                    let i = tagCount,
                        last = true;
                    indexMap.clear();
                    for (const item of elements) {
                        let tagIndex = item.tagIndex!;
                        if (item.index! > documentIndex) {
                            tagIndex += offset + 1;
                            last = false;
                        }
                        indexMap.add(tagIndex);
                    }
                    if (!last) {
                        while (indexMap.has(i)) {
                            --i;
                        }
                        i -= offset;
                    }
                    for (const target of revised) {
                        target.tagIndex = i;
                        target.tagCount = tagCount + offset + 1;
                    }
                    return;
                }
                this.resetTag(tagName);
            }
        }
    }
    resetTag(tagName: string) {
        for (const item of this.elements) {
            if (item.tagName === tagName) {
                resetTagPosition(item);
            }
            const append = item.append;
            if (append?.tagName === tagName) {
                delete append.tagCount;
            }
        }
        delete this._tagCount[tagName];
    }
    resetPosition(startIndex?: number) {
        const rootName = this.rootName;
        for (const item of this.elements) {
            deletePosition(item, rootName, startIndex);
        }
    }
    close() {
        const source = this.source;
        this.source = '';
        this.elements.length = 0;
        return source;
    }
    getOuterXmlById(id: string, caseSensitive = true, options?: OuterXmlByIdOptions) {
        let tagName: Undef<string>,
            tagVoid: Undef<boolean>;
        if (options) {
            ({ tagName, tagVoid } = options);
        }
        const source = this.source;
        let match = new RegExp(`<(${tagName && Module.escapePattern(tagName) || '[^\\s>]+'})${XmlWriter.PATTERN_TAGOPEN}+?${Module.escapePattern(this.nameOfId)}="${Module.escapePattern(id)}"`, caseSensitive ? '' : 'i').exec(source);
        if (match) {
            tagName ||= match[1];
            const startIndex = match.index;
            let endIndex = -1,
                closeTag = 0;
            if (!tagVoid) {
                let openTag = 1;
                const pattern = new RegExp(`(<${Module.escapePattern(tagName)}\\s*)|(</${Module.escapePattern(tagName)}\\s*>)`, caseSensitive ? 'g' : 'gi');
                while (match = pattern.exec(source)) {
                    if (match[1]) {
                        ++openTag;
                    }
                    else if (openTag === ++closeTag) {
                        endIndex = match.index + match[0].length - 1;
                        break;
                    }
                }
            }
            if (closeTag === 0) {
                endIndex = XmlWriter.findCloseTag(source, startIndex);
            }
            if (endIndex !== -1) {
                return { tagName, outerXml: source.substring(startIndex, endIndex + 1), startIndex, endIndex, lowerCase: !caseSensitive } as SourceTagNode;
            }
        }
    }
    setRawString(targetXml: string, outerXml: string) {
        const startIndex = this.source.indexOf(targetXml);
        return startIndex !== -1 ? this.spliceRawString({ startIndex, endIndex: startIndex + targetXml.length - 1, outerXml }) : '';
    }
    getRawString(index: SourceIndex) {
        return this.source.substring(index.startIndex, index.endIndex + 1);
    }
    spliceRawString(content: SourceContent, reset = true) {
        const { startIndex, endIndex, outerXml } = content;
        if (reset) {
            this.resetPosition(startIndex);
        }
        ++this.modifyCount;
        return this.source = this.source.substring(0, startIndex) + outerXml + this.source.substring(endIndex + 1);
    }
    hasErrors() {
        return this.errors.length > 0;
    }
    reset() {
        this.modifyCount = 0;
        this.failCount = 0;
        this.errors.length = 0;
        this.resetPosition();
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

    protected _modified = true;
    protected _tagName = '';
    protected _innerXml = '';
    protected _remove = false;
    protected _prevTagName: Null<string> = null;
    protected _prevInnerXml: Null<string> = null;
    protected _lowerCase: boolean;
    protected _tagOffset?: TagOffsetMap;
    protected _tagVoid = false;
    protected readonly _attributes = new Map<string, Optional<string>>();

    abstract readonly TAG_VOID: string[];

    constructor(
        public readonly documentName: string,
        public readonly node: XmlTagNode,
        attributes?: StandardMap,
        tagVoid?: boolean)
    {
        const lowerCase = node.lowerCase || false;
        const attrs = this._attributes;
        applyAttributes(attrs, node.attributes, lowerCase);
        applyAttributes(attrs, attributes, lowerCase);
        this._lowerCase = lowerCase;
        if (!node.append) {
            this._modified = attrs.size > 0;
            if (node.outerXml) {
                const [tagStart, innerXml, isVoid] = this.parseOuterXml(node.outerXml, tagVoid);
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
                this._tagVoid = isVoid;
                REGEXP_ATTRVALUE.lastIndex = 0;
                REGEXP_ATTRNAME.lastIndex = 0;
            }
            else if (node.innerXml) {
                this._innerXml = node.innerXml;
            }
        }
    }

    abstract findIndexOf(source: string): Undef<SourceIndex>;

    abstract set id(value: string);
    abstract get id(): string;
    abstract get outerXml(): string;
    abstract get nameOfId(): string;

    parseOuterXml(outerXml = this.node.outerXml, tagVoid?: boolean): [string, string, boolean] {
        let tagStart: Undef<string>,
            innerXml: Undef<string>;
        if (outerXml) {
            const endIndex = XmlWriter.findCloseTag(outerXml) + 1;
            if (endIndex !== 0) {
                if (endIndex === outerXml.length) {
                    return [outerXml, '', true];
                }
                let lastIndex = -1;
                if (tagVoid === true || (lastIndex = outerXml.lastIndexOf('<')) && lastIndex < endIndex) {
                    return [outerXml.substring(0, endIndex), '', true];
                }
                tagStart = outerXml.substring(0, endIndex);
                innerXml = outerXml.substring(endIndex, lastIndex);
            }
        }
        return [tagStart || `<${this.tagName}>`, innerXml || '', false];
    }
    getTagOffset(nextXml?: string) {
        if (!this.tagVoid || this._prevTagName && !this.TAG_VOID.includes(this._prevTagName)) {
            if (this.node.append) {
                if (nextXml) {
                    return XmlWriter.getTagOffset(nextXml);
                }
            }
            else {
                return XmlWriter.getTagOffset(this.innerXml, nextXml);
            }
        }
    }
    setAttribute(name: string, value: string) {
        if (this._attributes.get(this._lowerCase ? name = name.toLowerCase() : name) !== value) {
            this._attributes.set(name, value);
            this._modified = true;
        }
    }
    getAttribute(name: string) {
        return this._attributes.get(this._lowerCase ? name = name.toLowerCase() : name) || this.node.append && name === this.nameOfId && (XmlWriter.getNodeId(this.node, this.documentName) || new RegExp(`\\s${Module.escapePattern(this.nameOfId)}="([^"]+)"`).exec(this.node.outerXml!)?.[1]) || '';
    }
    removeAttribute(...names: string[]) {
        const attrs = this._attributes;
        for (let name of names) {
            if (attrs.has(this._lowerCase ? name = name.toLowerCase() : name)) {
                attrs.delete(name);
                this._modified = true;
            }
        }
    }
    hasAttribute(name: string) {
        return this._attributes.has(this._lowerCase ? name.toLowerCase() : name);
    }
    replace(source: string, options: ReplaceOptions): WriteResult {
        let { startIndex, endIndex } = options,
            leading = '',
            outerXml = '',
            trailing = '';
        if (options.remove) {
            let i = endIndex;
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
            i = startIndex - 1;
            while (isSpace(source[i])) {
                leading = source[i--] + leading;
            }
            startIndex -= leading.length;
            endIndex += trailing.length + 1;
            leading = '';
        }
        else {
            if (options.append) {
                let newline: Undef<boolean>,
                    i = startIndex - 1;
                while (isSpace(source[i])) {
                    if (source[i] === '\n') {
                        newline = true;
                        break;
                    }
                    leading = source[i--] + leading;
                }
                if (!options.append.prepend) {
                    endIndex += 2;
                    startIndex = endIndex;
                    if (!newline) {
                        leading = this.newline + leading;
                        trailing = this.newline;
                    }
                    else {
                        switch (source[endIndex]) {
                            case '\n':
                                break;
                            case '\r':
                                if (source[endIndex + 1] === '\n') {
                                    break;
                                }
                            default:
                                trailing = this.newline;
                                break;
                        }
                    }
                }
                else {
                    trailing = this.newline + leading;
                    endIndex = startIndex;
                    leading = '';
                }
            }
            else {
                ++endIndex;
            }
            outerXml = this.outerXml;
            const node = this.node;
            node.startIndex = startIndex + leading.length;
            node.endIndex = node.startIndex + outerXml.length - 1;
        }
        return [source.substring(0, startIndex) + leading + outerXml + trailing + source.substring(endIndex), outerXml];
    }
    write(source: string, options?: WriteOptions): WriteResult {
        let append: Undef<TagAppend>;
        if (options) {
            ({ append } = options);
        }
        const { id, node, remove } = this;
        if (this._modified || append || remove) {
            if (this.hasPosition()) {
                return this.replace(source, { remove, append, startIndex: node.startIndex!, endIndex: node.endIndex! });
            }
            const { tagName, tagIndex = -1, tagCount = Infinity, lowerCase } = node;
            const errorResult = (): [string, string, Error] => ['', '', new Error(tagName.toUpperCase() + (isIndex(tagIndex) ? ' ' + tagIndex : '') + ': Element was not found.')];
            const tagVoid = this.TAG_VOID.includes(tagName);
            const voidId = tagVoid && !!id;
            const onlyId = !isIndex(tagIndex) || !!append;
            const openTag: number[] = [];
            const hasId = (startIndex: number, endIndex?: number) => !!id && source.substring(startIndex, endIndex).includes(id);
            const getTagStart = (startIndex: number, endIndex = XmlWriter.findCloseTag(source, startIndex), checkId?: boolean) => endIndex !== -1 && (!checkId || hasId(startIndex, endIndex)) ? this.replace(source, { remove, append, startIndex, endIndex }) : null;
            let openCount = 0,
                result: Null<WriteResult>,
                pattern = new RegExp(`<${Module.escapePattern(tagName)}[\\s|>]`, lowerCase ? 'gi' : 'g'),
                match: Null<RegExpExecArray>;
            while (match = pattern.exec(source)) {
                const index = match.index;
                const end = XmlWriter.findCloseTag(source, index);
                if (end !== -1) {
                    if (voidId && (openCount === tagIndex || onlyId) && (result = getTagStart(index, end, true))) {
                        return result;
                    }
                    openCount = openTag.push(index);
                    pattern.lastIndex = end;
                }
                else {
                    break;
                }
            }
            let position: Undef<SourceIndex>;
            if (tagVoid) {
                if (openCount === tagCount && isIndex(tagIndex) && (result = getTagStart(openTag[tagIndex]))) {
                    return result;
                }
            }
            else if (id || isIndex(tagIndex) && isCount(tagCount)) {
                complete: {
                    const closeTag: number[] = [];
                    const foundIndex: SourceIndex[] = [];
                    let foundCount = 0;
                    pattern = new RegExp(`</${Module.escapePattern(tagName)}\\s*>`, lowerCase ? 'gi' : 'g');
                    while (match = pattern.exec(source)) {
                        closeTag.push(match.index + match[0].length - 1);
                    }
                    const closeCount = closeTag.length;
                    if (closeCount) {
                        for (let i = 0; i < openCount; ++i) {
                            let j = 0,
                                valid: Undef<boolean>;
                            found: {
                                const k = openTag[i];
                                let start = i + 1,
                                    opened = 1,
                                    closed = 0;
                                for ( ; j < closeCount; ++j) {
                                    const l = closeTag[j];
                                    if (l > k) {
                                        ++closed;
                                        for (let m = start; m < openCount; ++m) {
                                            const n = openTag[m];
                                            if (n < l) {
                                                ++opened;
                                                ++start;
                                            }
                                            else {
                                                break;
                                            }
                                        }
                                        if (opened === closed) {
                                            valid = true;
                                            break found;
                                        }
                                    }
                                }
                            }
                            if (valid) {
                                const next: SourceIndex = { startIndex: openTag[i], endIndex: closeTag[j] };
                                if (id) {
                                    if (foundCount === tagCount - 1 && hasId(openTag[i])) {
                                        position = next;
                                        break complete;
                                    }
                                    else {
                                        let index: Undef<SourceIndex>;
                                        if (append || !isIndex(tagIndex)) {
                                            if (foundCount) {
                                                index = foundIndex[foundCount - 1];
                                            }
                                        }
                                        else if (foundCount === tagIndex + 1) {
                                            index = foundIndex[tagIndex];
                                        }
                                        if (index && hasId(index.startIndex, openTag[i])) {
                                            position = index;
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
                    if (append && id) {
                        position = foundIndex[foundCount - 1];
                        if (!hasId(position.startIndex, position.endIndex)) {
                            return errorResult();
                        }
                    }
                    else if (foundCount === tagCount && isIndex(tagIndex)) {
                        position = foundIndex[tagIndex];
                    }
                }
            }
            position ||= this.findIndexOf(source);
            return position ? this.replace(source, { remove, append, ...position }) : errorResult();
        }
        return ['', ''];
    }
    save(source: string, options?: WriteOptions): SaveResult {
        const [output, outerXml, error] = this.write(source, options);
        if (output) {
            this.node.outerXml = outerXml;
            this.reset();
        }
        return [output, error];
    }
    reset() {
        this._tagOffset &&= undefined;
        this._prevTagName = null;
        this._prevInnerXml = null;
        this._modified = false;
    }
    hasPosition() {
        return isIndex(this.node.startIndex) && isIndex(this.node.endIndex);
    }
    protected getContent(): [string, AttributeMap | AttributeList, Undef<string>] {
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
            if (textContent) {
                this.innerXml = textContent;
            }
        }
        else {
            tagName = this.tagName;
            items = this._attributes;
        }
        return [tagName, items, textContent];
    }
    set tagName(value: string) {
        if (this.node.lowerCase) {
            value = value.toLowerCase();
        }
        const tagName = this.tagName;
        if (value !== tagName) {
            this._prevTagName ||= tagName;
            this._tagName = value;
            if (this.TAG_VOID.includes(value)) {
                this.innerXml = '';
            }
            this._modified = true;
        }
    }
    get tagName() {
        const tagName = this._tagName || this.node.tagName;
        return this.node.lowerCase ? tagName.toLowerCase() : tagName;
    }
    get tagVoid() {
        return this.TAG_VOID.length ? this.TAG_VOID.includes(this.tagName) : this._tagVoid;
    }
    set innerXml(value) {
        if (value !== this._innerXml) {
            if (typeof this._prevInnerXml === 'string') {
                this._innerXml = this._prevInnerXml;
            }
            this._tagOffset = this.getTagOffset(value);
            this._prevInnerXml = this._innerXml;
            this._innerXml = value;
            this._modified = true;
        }
    }
    get innerXml() {
        return this._innerXml;
    }
    set tagOffset(value) {
        this._tagOffset = value && Object.keys(value).length ? value : undefined;
    }
    get tagOffset() {
        return this._tagOffset;
    }
    set remove(value) {
        if (value) {
            const tagOffset = this.getTagOffset();
            if (tagOffset) {
                for (const tagName in tagOffset) {
                    tagOffset[tagName]! *= -1;
                }
                this._tagOffset = tagOffset;
            }
            this._modified = true;
        }
        else {
            this._tagOffset &&= undefined;
        }
        this._remove = value;
    }
    get remove() {
        return this._remove;
    }
    get modified() {
        return this._modified;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { XmlWriter, XmlElement };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}