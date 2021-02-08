import type { TagAppend, TagIndex } from '../../types/lib/squared';

import type { AttributeMap, IXmlElement, IXmlWriter, SaveResult, SourceContent, SourceIndex, WriteOptions, WriteResult, XmlNodeTag } from './document';

import escapeRegexp = require('escape-string-regexp');
import uuid = require('uuid');

type WriteSourceIndex = [number, number, string?];

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
        return leading.includes('\n') || /(?:\r?\n){2,}$/.test(trailing) ? newline ? newline : (leading + trailing).includes('\r') ? '\r\n' : '\n' : '';
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

    modifyCount = 0;
    failCount = 0;
    errors: Error[] = [];
    newline = '\n';
    readonly rootName?: string;

    protected _tagCount: ObjectMap<number> = {};

    constructor(
        public documentName: string,
        public source: string,
        public elements: XmlNodeTag[])
    {
    }

    abstract newElement(node: XmlNodeTag): IXmlElement;

    abstract get nameOfId(): string;

    init() {
        const appending: XmlNodeTag[] = [];
        const elements = this.elements;
        for (let i = 0; i < elements.length; ++i) {
            const item = elements[i];
            const append = item.prepend || item.append;
            if (append) {
                appending.push(item);
                elements.splice(i--, 1);
            }
            if (item.tagCount > 0) {
                this._tagCount[item.tagName] = item.tagCount;
            }
        }
        if (appending.length) {
            this.insertNodes(appending);
        }
    }
    insertNodes(nodes: XmlNodeTag[]) {
        nodes.sort((a, b) => {
            if (a.index === b.index) {
                if (a.prepend && b.prepend) {
                    return a.prepend.order - b.prepend.order;
                }
                else if (a.append && b.append) {
                    return b.append.order - a.append.order;
                }
                else if (a.prepend || b.append) {
                    return 1;
                }
                else if (a.append || b.prepend) {
                    return -1;
                }
            }
            return b.index - a.index;
        });
        for (const item of nodes) {
            if (item.prepend) {
                this.prepend(item);
            }
            else if (item.append) {
                this.append(item);
            }
        }
    }
    fromNode(node: XmlNodeTag, append?: TagAppend) {
        const element = this.newElement(node);
        if (append) {
            const tagName = append.tagName;
            if (!(tagName in this._tagCount)) {
                this._tagCount[tagName] = append.tagCount;
            }
            append.id ||= this.newId;
        }
        return element;
    }
    append(node: XmlNodeTag) {
        const append = node.append;
        if (append) {
            const element = this.fromNode(node, append);
            if (this.write(element, { append })) {
                delete node.prepend;
                delete node.append;
                return element;
            }
            this.errors.push(new Error(`Unable to append element ${append.tagName.toUpperCase()} at index ${node.index}`));
        }
        return null;
    }
    prepend(node: XmlNodeTag) {
        const prepend = node.prepend;
        if (prepend) {
            const element = this.fromNode(node, prepend);
            if (this.write(element, { prepend })) {
                delete node.prepend;
                delete node.append;
                return element;
            }
            this.errors.push(new Error(`Unable to prepend element ${prepend.tagName.toUpperCase()} at index ${node.index}`));
        }
        return null;
    }
    write(element: IXmlElement, options?: WriteOptions) {
        let remove: Undef<boolean>,
            rename: Undef<boolean>,
            append: Undef<TagAppend>,
            prepend: Undef<TagAppend>;
        if (options) {
            ({ remove, rename, append, prepend } = options);
        }
        element.newline = this.newline;
        let output: Undef<string>,
            outerXml = '',
            error: Optional<Error> = null;
        if (!remove && !append && !prepend) {
            if (!element.modified) {
                return true;
            }
            if (element.tagName !== this.rootName) {
                const id = element.id;
                if (id) {
                    const lowerCase = element.node.lowerCase;
                    const content = this.getOuterXmlById(id, !lowerCase);
                    if (content && content.tagName === element.tagName) {
                        content.outerXml = remove ? '' : element.outerXml;
                        output = this.spliceRawString(content);
                        outerXml = content.outerXml;
                    }
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
            const data = append || prepend;
            if (data) {
                this.elements.push(node);
                if (append) {
                    ++node.index;
                }
                element.id = data.id!;
                node.outerXml = outerXml;
                const tagName = data.tagName;
                if (tagName !== node.tagName) {
                    node.tagName = tagName;
                    node.tagIndex = -1;
                    this.increment(node, !!prepend);
                    this.indexTag(tagName, true);
                }
                else {
                    this.increment(node, !!prepend);
                }
            }
            else if (remove) {
                this.decrement(node, remove);
            }
            else if (rename && element.tagName !== node.tagName) {
                this.renameTag(node, element.tagName);
            }
            this.update(node, outerXml);
            return true;
        }
        if (error) {
            this.errors.push(error);
        }
        ++this.failCount;
        return false;
    }
    save() {
        for (const item of this.elements) {
            delete item.startIndex;
            delete item.endIndex;
        }
        this.modifyCount = 0;
        return this.source;
    }
    update(node: XmlNodeTag, outerXml: string) {
        const { index, startIndex = -1 } = node;
        for (const item of this.elements) {
            if (outerXml && item.index === index) {
                item.outerXml = outerXml;
            }
            else if (item.startIndex !== undefined && (item.startIndex >= startIndex && startIndex !== -1 || startIndex === -1 && item.tagName !== this.rootName)) {
                delete item.startIndex;
                delete item.endIndex;
            }
        }
    }
    updateByTag(node: Required<TagIndex>, content: SourceContent) {
        const { tagName, tagIndex, tagCount } = node;
        const { startIndex, endIndex, outerXml } = content;
        for (const item of this.elements) {
            if (item.tagName === tagName) {
                if (item.tagCount === tagCount) {
                    if (item.tagIndex === tagIndex) {
                        item.startIndex = startIndex;
                        item.endIndex = endIndex;
                        item.outerXml = outerXml;
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
        this.spliceRawString(content);
        return true;
    }
    increment(node: XmlNodeTag, prepend?: boolean) {
        const { index, tagName, tagIndex } = node;
        for (const item of this.elements) {
            if (item === node) {
                if (tagIndex !== -1) {
                    ++item.tagIndex;
                    ++item.tagCount;
                }
            }
            else {
                if (tagIndex !== -1 && item.tagName === tagName) {
                    if (prepend) {
                        if (item.tagIndex >= tagIndex) {
                            ++item.tagIndex;
                        }
                    }
                    else if (item.tagIndex > tagIndex) {
                        ++item.tagIndex;
                    }
                    ++item.tagCount;
                }
                if (item.index >= index) {
                    ++item.index;
                }
            }
        }
        ++this._tagCount[tagName];
    }
    decrement(node: XmlNodeTag, remove?: boolean) {
        const { index, tagName, tagIndex } = node;
        const elements = this.elements;
        const result: XmlNodeTag[] = [];
        for (let i = 0; i < elements.length; ++i) {
            const item = elements[i];
            if (item.tagName === tagName) {
                if (item.tagIndex === tagIndex) {
                    if (remove) {
                        elements.splice(i--, 1);
                        continue;
                    }
                    else {
                        result.push(item);
                    }
                }
                else {
                    if (item.tagIndex > tagIndex) {
                        --item.tagIndex;
                    }
                    --item.tagCount;
                }
            }
            if (remove && item.index > index) {
                --item.index;
            }
        }
        --this._tagCount[tagName];
        return result;
    }
    renameTag(node: XmlNodeTag, tagName: string) {
        const revised = this.decrement(node);
        if (revised.length) {
            const related = this.elements.find(item => item.tagName === tagName);
            if (related) {
                for (const item of revised) {
                    item.tagName = tagName;
                    item.tagIndex = -1;
                }
                ++this._tagCount[tagName];
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
            this.errors.push(new Error(`Unable to rename element ${node.tagName.toUpperCase()} -> ${tagName.toUpperCase()} at index ${node.index}`));
        }
    }
    indexTag(tagName: string, append?: boolean) {
        const elements: XmlNodeTag[] = [];
        const revised: XmlNodeTag[] = [];
        const index = new Set<number>();
        let documentIndex = -1;
        for (const item of this.elements) {
            if (item.tagName === tagName) {
                if (item.tagIndex === -1) {
                    documentIndex = item.index;
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
        else if (index.size === tagCount) {
            if (documentIndex !== -1) {
                let i = tagCount - 1;
                index.clear();
                for (const item of elements) {
                    if (item.index > documentIndex) {
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
        const source = this.source;
        this.source = '';
        this.elements.length = 0;
        return source;
    }
    getOuterXmlById(id: string, caseSensitive = true) {
        const source = this.source;
        let match = new RegExp(`<([^>\\s]+)(?:"[^"]*"|'[^']*'|[^"'>])+?${escapeRegexp(this.nameOfId)}="${escapeRegexp(id)}"`).exec(source);
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
        return this.source.substring(startIndex, endIndex);
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
    newline = '\n';

    protected _modified = false;
    protected _tagName = '';
    protected _innerXml = '';
    protected readonly _attributes = new Map<string, Optional<string>>();

    abstract readonly TAG_VOID: string[];

    constructor(
        public readonly documentName: string,
        public readonly node: XmlNodeTag,
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
                const hasValue = (name: string) => /^[a-z][\w-:.]*$/.test(name) && !attrs.has(name);
                let pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]*))/g,
                    source = tagStart,
                    match: Null<RegExpExecArray>;
                while (match = pattern.exec(tagStart)) {
                    const attr = lowerCase ? match[1].toLowerCase() : match[1];
                    if (hasValue(attr)) {
                        attrs.set(attr, match[2] || match[3] || match[4] || '');
                    }
                    source = source.replace(match[0], '');
                }
                pattern = /[^<]\s+([\w-:.]+)/g;
                while (match = pattern.exec(source)) {
                    const attr = lowerCase ? match[1].toLowerCase() : match[1];
                    if (hasValue(attr)) {
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

    parseOuterXml(outerXml = this.node.outerXml): [string, string] {
        let tagStart: Undef<string>;
        if (outerXml) {
            const endIndex = XmlWriter.findCloseTag(outerXml) + 1;
            if (endIndex !== 0) {
                if (this.tagVoid) {
                    return [endIndex === outerXml.length ? outerXml : outerXml.substring(0, endIndex), ''];
                }
                const lastIndex = outerXml.lastIndexOf('<');
                tagStart = outerXml.substring(0, endIndex);
                if (endIndex < lastIndex) {
                    return [tagStart, outerXml.substring(endIndex, lastIndex)];
                }
            }
        }
        return [tagStart || `<${this.tagName}>`, ''];
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
            append: Undef<TagAppend>,
            prepend: Undef<TagAppend>;
        if (options) {
            ({ remove, append, prepend } = options);
        }
        const appending = !!(append || prepend);
        const error: Optional<Error> = null;
        if (this._modified || remove || appending) {
            const node = this.node;
            const outerXml = !remove || appending ? this.outerXml : '';
            const spliceSource = (index: WriteSourceIndex) => {
                let [startIndex, endIndex, trailing = ''] = index,
                    leading = '';
                node.startIndex = startIndex;
                node.endIndex = startIndex + outerXml.length - 1;
                if (appending) {
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
                    if (append) {
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
                    if (remove) {
                        trailing = '';
                    }
                }
                return source.substring(0, startIndex) + leading + outerXml + trailing + source.substring(endIndex);
            };
            const { tagName, tagCount, tagIndex, lowerCase } = node;
            const { startIndex, endIndex } = node;
            if (startIndex !== undefined && endIndex !== undefined) {
                return [spliceSource([startIndex, endIndex]), outerXml, error];
            }
            const id = this.id;
            const errorResult = (message: string): [string, string, Error] => ['', '', new Error(`${tagName.toUpperCase()} ${tagIndex}: ${message}`)];
            if (append && !id) {
                return errorResult('Element id is missing.');
            }
            const foundIndex: WriteSourceIndex[] = [];
            const openTag: number[] = [];
            const tagVoid = this.TAG_VOID.includes(tagName);
            const selfId = tagVoid && !!id;
            const hasId = (start: number, end?: number) => !!id && source.substring(start, end).includes(id);
            const getTagStart = (start: number): Null<WriteResult> => {
                const end = XmlWriter.findCloseTag(source, start);
                return end !== -1 && hasId(start, end) ? [spliceSource([start, end]), outerXml, error] : null;
            };
            let tag = new RegExp(`<${escapeRegexp(tagName)}[\\s|>]`, lowerCase ? 'gi' : 'g'),
                openCount = 0,
                result: Null<WriteResult>,
                match: Null<RegExpExecArray>;
            while (match = tag.exec(source)) {
                if (selfId && (openCount === tagIndex || tagIndex === -1 || append) && (result = getTagStart(match.index))) {
                    return result;
                }
                openCount = openTag.push(match.index);
            }
            if (selfId && (tagIndex === tagCount - 1 && openCount === tagCount || tagIndex === -1 || append) && (result = getTagStart(openTag[openCount - 1]))) {
                return result;
            }
            let sourceIndex: Undef<WriteSourceIndex>;
            if (openCount && !tagVoid) {
                found: {
                    const closeIndex: number[] = [];
                    let foundCount = 0;
                    tag = new RegExp(`</${escapeRegexp(tagName)}\\s*>`, lowerCase ? 'gi' : 'g');
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
                                const next: WriteSourceIndex = [openTag[i], closeIndex[j]];
                                if (id) {
                                    if (foundCount === tagCount - 1 && hasId(openTag[i])) {
                                        sourceIndex = next;
                                        break found;
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
                                            break found;
                                        }
                                    }
                                }
                                foundCount = foundIndex.push(next);
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
                return [spliceSource(sourceIndex), outerXml, error];
            }
        }
        return ['', '', error];
    }
    save(source: string, options?: WriteOptions): SaveResult {
        const [output, outerXml, error] = this.write(source, options);
        if (output) {
            this.node.outerXml = outerXml;
            this._modified = false;
        }
        return [output, error];
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
        return this._tagName ||= this.node.tagName;
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