import type { TagAppend } from '../../types/lib/squared';

import type { AttributeList, AttributeMap, IXmlElement, IXmlWriter, OuterXmlByIdOptions, OuterXmlOptions, ReplaceOptions, SaveResult, SourceContent, SourceIndex, SourceTagNode, TagOffsetMap, WriteResult, XmlTagNode } from './document';

import uuid = require('uuid');
import htmlparser2 = require('htmlparser2');

import Module from '../../module';

const Parser = htmlparser2.Parser;

const PATTERN_ATTRNAME = '([^\\s=>]+)';
const PATTERN_ATTRVALUE = `=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]*))`;
const REGEXP_ATTRNAME = new RegExp('\\s+' + PATTERN_ATTRNAME, 'g');
const REGEXP_ATTRVALUE = new RegExp(PATTERN_ATTRNAME + '\\s*' + PATTERN_ATTRVALUE, 'g');
const TAGNAME_CACHE: ObjectMap<RegExp> = {};

function isSpace(ch: string) {
    switch (ch) {
        case ' ':
        case '\n':
        case '\t':
        case '\f':
        case '\r':
        case '\v':
            return true;
        default:
            return false;
    }
}

function applyAttributes(attrs: AttributeMap, data: Undef<StandardMap>, ignoreCase: boolean) {
    if (data) {
        for (const key in data) {
            attrs.set(ignoreCase ? key.toLowerCase() : key, data[key]);
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

function findCloseIndex(source: string, tagName: string, lastIndex: number, ignoreCase?: boolean): [number, number] {
    const flags = ignoreCase ? 'gi' : 'g';
    const pattern = TAGNAME_CACHE[tagName + flags] ||= new RegExp(`(<${Module.escapePattern(tagName)}\\s*)|(</${Module.escapePattern(tagName)}\\s*>)`, flags);
    pattern.lastIndex = lastIndex;
    let openTag = 1,
        closeTag = 0,
        match: Null<RegExpExecArray>;
    while (match = pattern.exec(source)) {
        if (match[1]) {
            ++openTag;
        }
        else if (openTag === ++closeTag) {
            return [match.index + match[0].length - 1, closeTag];
        }
    }
    return [-1, closeTag];
}

function isValidIndex(items: Optional<SourceIndex[]>, value: number) {
    if (items) {
        for (const item of items) {
            if (value > item.startIndex && value < item.endIndex) {
                return false;
            }
        }
    }
    return true;
}

const isNode = (item: XmlTagNode, index: Undef<number>, tagIndex: Undef<number>, tagCount: Undef<number>, id: Undef<string>, documentName: string) => item.index === index && isIndex(index) || id && id === XmlWriter.getNodeId(item, documentName) || item.tagIndex === tagIndex && isIndex(tagIndex) && item.tagCount === tagCount && isCount(tagCount);
const isIndex = (value: Undef<unknown>): value is number => typeof value === 'number' && value >= 0 && value !== Infinity;
const isCount = (value: Undef<unknown>): value is number => typeof value === 'number' && value > 0 && value !== Infinity;

export abstract class XmlWriter implements IXmlWriter {
    static readonly PATTERN_ATTRNAME = PATTERN_ATTRNAME;
    static readonly PATTERN_ATTRVALUE = PATTERN_ATTRVALUE;
    static readonly PATTERN_TAGOPEN = `(?:[^=>]|${PATTERN_ATTRVALUE})`;
    static readonly PATTERN_TRAILINGSPACE = '[ \\t]*((?:\\r?\\n)*)';

    static escapeXmlString(value: string, ampersand?: boolean) {
        return value.replace(/[<>"'&]/g, capture => {
            switch (capture) {
                case '<':
                    return '&lt;';
                case '>':
                    return '&gt;';
                case '"':
                    return '&quot;';
                case "'":
                    return '&apos;';
                default:
                    return ampersand ? '&amp;' : '&';
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

    static getCommentsAndCDATA(source: string, nodePattern = '', ignoreCase?: boolean) {
        const result: SourceContent[] = [];
        const flags = ignoreCase ? 'gi' : 'g';
        const pattern = TAGNAME_CACHE[nodePattern + flags] ||= new RegExp(`<(?:(!--[\\S\\s]*?--)|(!\\[CDATA\\[[\\S\\s]*?\\]\\])` + (nodePattern ? '|' + `(${nodePattern})${XmlWriter.PATTERN_TAGOPEN}*` : '') + ')>', flags);
        pattern.lastIndex = 0;
        let match: Null<RegExpExecArray>;
        while (match = pattern.exec(source)) {
            const type = match[1] && 'comment' || match[2] && 'cdata' || 'node';
            let outerXml = match[0],
                endIndex = match.index + outerXml.length - 1;
            if (type === 'node') {
                endIndex = findCloseIndex(source, match[3], endIndex, ignoreCase)[0];
                if (endIndex === -1) {
                    continue;
                }
                outerXml = source.substring(match.index, endIndex + 1);
            }
            result.push({ type, outerXml, startIndex: match.index, endIndex });
        }
        return result;
    }

    modifyCount = 0;
    failCount = 0;
    errors: Error[] = [];
    newline = '\n';
    readonly rootName?: string;
    readonly ignoreTagName?: string;
    readonly ignoreCaseTagName?: boolean;

    protected _tagCount: ObjectMap<number> = {};
    protected _hasInvalidContent = true;

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
    getInvalidArea() {
        if (this._hasInvalidContent) {
            const result = XmlWriter.getCommentsAndCDATA(this.source, this.ignoreTagName, this.ignoreCaseTagName);
            if (result.length) {
                return result;
            }
            this._hasInvalidContent = false;
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
            element.setAppend(append);
        }
        return element;
    }
    append(node: XmlTagNode) {
        const append = node.append;
        if (append) {
            const element = this.fromNode(node, append);
            if (this.write(element)) {
                delete node.append;
                return element;
            }
            const index = this.elements.findIndex(item => item === node);
            if (index !== -1) {
                this.elements.splice(index, 1);
            }
            this.errors.push(new Error(`Unable to ${append.prepend ? 'prepend' : 'append'} element ` + append.tagName.toUpperCase() + (isIndex(node.index) ? ' at index ' + node.index : '')));
        }
        return null;
    }
    write(element: IXmlElement) {
        if (!element.modified) {
            return true;
        }
        const { node, append } = element;
        element.newline = this.newline;
        let output: Undef<string>,
            outerXml = '',
            error: Optional<Error>;
        if (element.hasPosition()) {
            [output, outerXml] = element.replace(this.source, { startIndex: node.startIndex!, endIndex: node.endIndex!, append, remove: element.remove });
        }
        else if (element.tagName !== this.rootName) {
            [output, outerXml, error] = element.write(this.source, this.getInvalidArea());
        }
        else {
            error = new Error('Root source position not found');
        }
        if (output) {
            this.source = output;
            if (!this.elements.includes(node)) {
                this.elements.push(node);
            }
            if (append) {
                const { tagName, id = '', textContent = '', prepend, nextSibling } = append;
                if (!prepend) {
                    node.index = nextSibling ?? -1;
                }
                (node.id ||= {})[this.documentName] = id;
                element.id = id;
                element.innerXml = textContent;
                const offset = element.getInnerOffset(tagName);
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
            else if (element.remove) {
                this.decrement(node, element.getInnerOffset(element.tagName), true);
            }
            else if (element.tagName !== node.tagName) {
                this.renameTag(node, element.tagName);
            }
            this.update(node, outerXml, append, element.tagOffset);
            if (element.innerXml && !element.remove) {
                this._hasInvalidContent ||= element.hasModifiedContent() || !!this.ignoreTagName && new RegExp(`^(?:${this.ignoreTagName})$`, this.ignoreCaseTagName ? 'i' : '').test(element.tagName);
            }
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
                                item.append.nextSibling = nextSibling + 1;
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
    getOuterXmlById(id: string, ignoreCase = false, options?: OuterXmlByIdOptions) {
        let tagName: Undef<string>,
            tagVoid: Undef<boolean>;
        if (options) {
            ({ tagName, tagVoid } = options);
        }
        const source = this.source;
        const match = new RegExp(`<(${tagName && Module.escapePattern(tagName) || '[^\\s>]+'})${XmlWriter.PATTERN_TAGOPEN}+?${Module.escapePattern(this.nameOfId)}="${Module.escapePattern(id)}"`, ignoreCase ? 'i' : '').exec(source);
        if (match) {
            tagName ||= match[1];
            const startIndex = match.index;
            let endIndex = -1,
                closeTag = 0;
            if (!tagVoid) {
                [endIndex, closeTag] = findCloseIndex(source, tagName, startIndex + match[0].length, ignoreCase);
            }
            if (closeTag === 0) {
                endIndex = XmlWriter.findCloseTag(source, startIndex);
            }
            if (endIndex !== -1) {
                return { tagName, id, outerXml: source.substring(startIndex, endIndex + 1), startIndex, endIndex, ignoreCase };
            }
        }
    }
    getOuterXmlByTagName(tagName: string, ignoreCase = false, options?: OuterXmlOptions) {
        let tagVoid: Undef<boolean>;
        if (options) {
            ({ tagVoid } = options);
        }
        const source = this.source;
        const invalid = this.getInvalidArea();
        const result: SourceTagNode[] = [];
        const pattern = new RegExp(`<${tagName + XmlWriter.PATTERN_TAGOPEN}*>`, ignoreCase ? 'gi' : 'g');
        const patternId = new RegExp(Module.escapePattern(this.nameOfId) + '="([^"]+)"');
        let match: Null<RegExpExecArray>;
        while (match = pattern.exec(source)) {
            const startIndex = match.index;
            if (isValidIndex(invalid, startIndex)) {
                let outerXml = match[0],
                    endIndex = startIndex + outerXml.length - 1;
                const id = patternId.exec(outerXml)?.[1];
                if (!tagVoid) {
                    const [index, closeTag] = findCloseIndex(source, tagName, endIndex, ignoreCase);
                    if (index !== -1) {
                        endIndex = index;
                        outerXml = source.substring(startIndex, endIndex + 1);
                    }
                    else if (closeTag > 0) {
                        continue;
                    }
                }
                result.push({ tagName, id, outerXml, startIndex, endIndex, ignoreCase });
            }
        }
        return result;
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
    TAG_VOID: string[] = [];

    protected _modified = true;
    protected _tagName = '';
    protected _innerXml = '';
    protected _remove = false;
    protected _tagVoid = false;
    protected _prevTagName: Null<string> = null;
    protected _prevInnerXml: Null<string> = null;
    protected _ignoreCase: boolean;
    protected _append?: TagAppend;
    protected _tagOffset?: TagOffsetMap;
    protected readonly _attributes = new Map<string, Optional<string>>();

    constructor(
        public readonly documentName: string,
        public readonly node: XmlTagNode,
        attributes?: StandardMap,
        tagVoid?: boolean)
    {
        const ignoreCase = node.ignoreCase || false;
        const attrs = this._attributes;
        applyAttributes(attrs, node.attributes, ignoreCase);
        applyAttributes(attrs, attributes, ignoreCase);
        this._ignoreCase = ignoreCase;
        if (!node.append) {
            this._modified = attrs.size > 0;
            if (node.outerXml) {
                const [tagStart, innerXml, isVoid] = this.parseOuterXml(node.outerXml, tagVoid);
                let source = tagStart,
                    match: Null<RegExpExecArray>;
                while (match = REGEXP_ATTRVALUE.exec(tagStart)) {
                    const attr = ignoreCase ? match[1].toLowerCase() : match[1];
                    if (!attrs.has(attr)) {
                        attrs.set(attr, match[2] || match[3] || match[4] || '');
                    }
                    source = source.replace(match[0], '');
                }
                while (match = REGEXP_ATTRNAME.exec(source)) {
                    const attr = ignoreCase ? match[1].toLowerCase() : match[1];
                    if (!attrs.has(attr)) {
                        attrs.set(attr, null);
                    }
                }
                this._innerXml = innerXml;
                this._tagVoid = isVoid;
                REGEXP_ATTRVALUE.lastIndex = 0;
                REGEXP_ATTRNAME.lastIndex = 0;
            }
            else {
                if (node.innerXml) {
                    this._innerXml = node.innerXml;
                }
                if (tagVoid) {
                    this._tagVoid = true;
                }
            }
            if (typeof node.textContent === 'string') {
                this.innerXml = node.textContent;
            }
        }
    }

    abstract findIndexOf(source: string): Undef<SourceIndex>;

    abstract get outerXml(): string;
    abstract get nameOfId(): string;

    setAppend(value?: TagAppend) {
        if (value) {
            this._append = value;
            this._modified = true;
        }
        else {
            this._append &&= undefined;
        }
    }
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
        if (this._attributes.get(this._ignoreCase ? name = name.toLowerCase() : name) !== value) {
            this._attributes.set(name, value);
            this._modified = true;
        }
    }
    getAttribute(name: string) {
        return this._attributes.get(this._ignoreCase ? name = name.toLowerCase() : name) || this.node.append && name === this.nameOfId && (XmlWriter.getNodeId(this.node, this.documentName) || new RegExp(`\\s${Module.escapePattern(this.nameOfId)}="([^"]+)"`).exec(this.node.outerXml!)?.[1]) || '';
    }
    removeAttribute(...names: string[]) {
        const attrs = this._attributes;
        for (let name of names) {
            if (attrs.has(this._ignoreCase ? name = name.toLowerCase() : name)) {
                attrs.delete(name);
                this._modified = true;
            }
        }
    }
    hasAttribute(name: string) {
        return this._attributes.has(this._ignoreCase ? name.toLowerCase() : name);
    }
    replace(source: string, options: ReplaceOptions): WriteResult {
        let { startIndex, endIndex } = options,
            leading = '',
            outerXml = '',
            trailing = '';
        if (options.remove) {
            let i = endIndex,
                ch: Undef<string>;
            while (isSpace(ch = source[i++])) {
                trailing += ch;
                if (ch === '\n') {
                    break;
                }
            }
            i = startIndex - 1;
            while (isSpace(ch = source[i--])) {
                leading = ch + leading;
            }
            startIndex -= leading.length;
            endIndex += trailing.length + 1;
            leading = '';
        }
        else {
            if (options.append) {
                let i = startIndex - 1,
                    ch: Undef<string>,
                    newline: Undef<boolean>;
                while (isSpace(ch = source[i--])) {
                    if (ch === '\n') {
                        newline = true;
                        break;
                    }
                    leading = ch + leading;
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
    write(source: string, invalid?: SourceIndex[]): WriteResult {
        if (this._modified) {
            const { id, node, remove, append } = this;
            if (this.hasPosition()) {
                return this.replace(source, { remove, append, startIndex: node.startIndex!, endIndex: node.endIndex! });
            }
            const { tagName, tagIndex = -1, tagCount = Infinity, ignoreCase } = node;
            const errorResult = (): [string, string, Error] => ['', '', new Error(tagName.toUpperCase() + (isIndex(tagIndex) ? ' ' + tagIndex : '') + ': Element was not found.')];
            const tagVoid = this.TAG_VOID.includes(tagName);
            const voidId = tagVoid && !!id;
            const onlyId = !isIndex(tagIndex) || !!append;
            const openTag: number[] = [];
            const hasId = (startIndex: number, endIndex?: number) => !!id && source.substring(startIndex, endIndex).includes(id);
            const getTagStart = (startIndex: number, endIndex = XmlWriter.findCloseTag(source, startIndex), checkId?: boolean) => endIndex !== -1 && (!checkId || hasId(startIndex, endIndex)) ? this.replace(source, { remove, append, startIndex, endIndex }) : null;
            let openCount = 0,
                result: Null<WriteResult>,
                pattern = new RegExp(`<${Module.escapePattern(tagName)}[\\s|>]`, ignoreCase ? 'gi' : 'g'),
                match: Null<RegExpExecArray>;
            while (match = pattern.exec(source)) {
                const index = match.index;
                const end = XmlWriter.findCloseTag(source, index);
                if (end !== -1) {
                    if (isValidIndex(invalid, end)) {
                        if (voidId && (openCount === tagIndex || onlyId) && (result = getTagStart(index, end, true))) {
                            return result;
                        }
                        openCount = openTag.push(index);
                    }
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
            else if (openTag.length && (id || isIndex(tagIndex) && isCount(tagCount))) {
                complete: {
                    const closeTag: number[] = [];
                    const foundIndex: SourceIndex[] = [];
                    let foundCount = 0;
                    pattern = new RegExp(`</${Module.escapePattern(tagName)}\\s*>`, ignoreCase ? 'gi' : 'g');
                    pattern.lastIndex = openTag[0];
                    while (match = pattern.exec(source)) {
                        if (isValidIndex(invalid, match.index)) {
                            closeTag.push(match.index + match[0].length - 1);
                        }
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
    save(source: string, invalid?: SourceIndex[]): SaveResult {
        const [output, outerXml, error] = this.write(source, invalid || XmlWriter.getCommentsAndCDATA(source));
        if (output) {
            this.node.outerXml = outerXml;
            this.reset();
        }
        return [output, error];
    }
    reset() {
        this._append &&= undefined;
        this._tagOffset &&= undefined;
        this._prevTagName = null;
        this._prevInnerXml = null;
        this._modified = false;
    }
    hasModifiedContent() {
        return typeof this._prevInnerXml === 'string';
    }
    getOuterContent(): [string, AttributeList, string] {
        const attributes = Array.from(this._attributes);
        const append = this.node.append;
        if (append) {
            const idKey = this.nameOfId;
            const items = attributes.filter(item => item[0] !== idKey);
            if (append.id) {
                items.push([idKey, append.id]);
            }
            return [append.tagName, items, append.textContent || ''];
        }
        return [this.tagName, attributes, this.innerXml];
    }
    getInnerOffset(tagName: string) {
        const tagOffset = this._tagOffset;
        return tagOffset && tagOffset[tagName] || 0;
    }
    hasPosition() {
        return isIndex(this.node.startIndex) && isIndex(this.node.endIndex);
    }
    set id(value: string) {
        this.setAttribute(this.nameOfId, value);
    }
    get id() {
        return this.getAttribute(this.nameOfId) || '';
    }
    set tagName(value: string) {
        if (this.node.ignoreCase) {
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
        return this.node.ignoreCase ? tagName.toLowerCase() : tagName;
    }
    get tagVoid() {
        return this.TAG_VOID.length ? this.TAG_VOID.includes(this.tagName) : this._tagVoid;
    }
    set innerXml(value) {
        if (value !== this._innerXml) {
            if (typeof this._prevInnerXml === 'string') {
                this._innerXml = this._prevInnerXml;
            }
            else {
                this._prevInnerXml = this._innerXml;
            }
            this._tagOffset = this.getTagOffset(value);
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
        if (value && !this._append) {
            const tagOffset = this.getTagOffset();
            if (tagOffset) {
                for (const tagName in tagOffset) {
                    tagOffset[tagName]! *= -1;
                }
                this._tagOffset = tagOffset;
            }
            this._remove = true;
            this._modified = true;
        }
        else {
            this._tagOffset &&= undefined;
            this._remove = false;
        }
    }
    get remove() {
        return this._remove;
    }
    get append() {
        return this._append;
    }
    get modified() {
        return this._modified;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { XmlWriter, XmlElement };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}