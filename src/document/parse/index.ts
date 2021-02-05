import type { TagAppend, TagIndex } from '../../types/lib/squared';

import type { FindIndexOfResult, IXmlElement, IXmlWriter, SaveResult, SourceContent, SourceIndex, WriteOptions, WriteResult, XmlNodeTag } from './document';

import escapeRegexp = require('escape-string-regexp');
import uuid = require('uuid');

type WriteSourceIndex = [number, number, string?];

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

export abstract class XmlWriter implements IXmlWriter {
    public static escapeXmlString(value: string) {
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

    public static getAttrId(document: string) {
        return `data-${document}-id`;
    }

    public modifyCount = 0;
    public failCount = 0;
    public errors: Error[] = [];
    public newline = '\n';
    public readonly rootName?: string;

    protected _tagCount: ObjectMap<number> = {};
    protected _appended: IXmlElement[] = [];

    private _appending?: XmlNodeTag[];

    constructor(public documentName: string, public source: string, public elements: XmlNodeTag[]) {
        const appending: XmlNodeTag[] = [];
        for (let i = 0; i < elements.length; ++i) {
            const item = elements[i];
            const tagName = item.tagName.toLowerCase();
            item.tagName = tagName;
            const append = item.prepend || item.append;
            if (append) {
                append.tagName = append.tagName.toLowerCase();
                appending.push(item as Required<XmlNodeTag>);
                elements.splice(i--, 1);
            }
            else {
                this._tagCount[tagName] = item.tagCount;
            }
        }
        appending
            .sort((a, b) => {
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
        this._appending = appending;
    }

    abstract newElement(node: XmlNodeTag): IXmlElement;

    init() {
        const appending = this._appending;
        if (appending) {
            for (let i = 0, length = appending.length; i < length; ++i) {
                const item = appending[i];
                const xmlElement = item.prepend ? this.prepend(item) : this.append(item);
                if (xmlElement) {
                    this._appended.push(xmlElement);
                }
            }
            delete this._appending;
        }
    }
    insertElement(node: XmlNodeTag, data: TagAppend): [IXmlElement, string] {
        const id = uuid.v4();
        const tagName = data.tagName;
        if (!(tagName in this._tagCount)) {
            this._tagCount[tagName] = data.tagCount;
        }
        const xmlElement = this.newElement(node);
        xmlElement.setAttribute(XmlWriter.getAttrId(this.documentName), id);
        return [xmlElement, id];
    }
    append(node: XmlNodeTag) {
        const data = node.append;
        if (data) {
            const [xmlElement, id] = this.insertElement(node, data);
            if (this.write(xmlElement, { append: node })) {
                (node.id ||= {})[this.documentName] = id;
                delete node.append;
                return xmlElement;
            }
            this.errors.push(new Error(`Unable to append element ${data.tagName.toUpperCase()} at index ${node.index}`));
        }
        return null;
    }
    prepend(node: XmlNodeTag) {
        const data = node.prepend;
        if (data) {
            const [xmlElement, id] = this.insertElement(node, data);
            if (this.write(xmlElement, { prepend: node })) {
                (node.id ||= {})[this.documentName] = id;
                delete node.prepend;
                delete node.append;
                return xmlElement;
            }
            this.errors.push(new Error(`Unable to prepend element ${data.tagName.toUpperCase()} at index ${node.index}`));
        }
        return null;
    }
    write(element: IXmlElement, options?: WriteOptions) {
        let remove: Undef<boolean>,
            rename: Undef<boolean>,
            append: Undef<XmlNodeTag>,
            prepend: Undef<XmlNodeTag>;
        if (options) {
            ({ remove, rename, append, prepend } = options);
        }
        if (!remove && !append && !element.modified) {
            return true;
        }
        element.newline = this.newline;
        const [output, outerXml, error] = element.write(this.source, options);
        if (output) {
            const node = element.node;
            const data = append || prepend;
            this.source = output;
            ++this.modifyCount;
            if (data) {
                this.elements.push(node);
                if (append) {
                    ++node.index;
                }
                node.outerXml = outerXml;
                const tagName = data.tagName;
                if (tagName !== node.tagName) {
                    node.tagName = tagName;
                    node.tagIndex = -1;
                    this.increment(node, !!prepend);
                    this.indexTag(tagName, true);
                }
                else {
                    this.increment(node);
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
            if (item.index === index) {
                item.outerXml = outerXml;
            }
            else if (item.startIndex !== undefined && (item.startIndex >= startIndex || startIndex === -1 && item.tagName !== this.rootName)) {
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
                continue;
            }
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
        ++this._tagCount[tagName];
    }
    decrement(node: XmlNodeTag, remove?: boolean) {
        const { index, tagName, tagIndex } = node;
        const result: XmlNodeTag[] = this.elements.filter(item => item.tagName === tagName && item.tagIndex === tagIndex);
        if (result.length) {
            for (const item of this.elements) {
                if (item.tagName === tagName && item.tagIndex !== tagIndex) {
                    if (item.tagIndex > tagIndex) {
                        --item.tagIndex;
                    }
                    --item.tagCount;
                }
                if (remove && item.index > index) {
                    --item.index;
                }
            }
            --this._tagCount[tagName];
        }
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
        else if (index.size !== tagCount) {
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
        return source.replace(new RegExp(`\\s+${XmlWriter.getAttrId(this.documentName)}="[^"]+"`, 'g'), '');
    }
    setRawString(targetXml: string, outerXml: string) {
        const current = this.source;
        this.source = current.replace(targetXml, outerXml);
        if (current !== this.source) {
            ++this.modifyCount;
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
    get modified() {
        return this.modifyCount > 0;
    }
}

export abstract class XmlElement implements IXmlElement {
    public static readonly TAG_VOID: string[] = [];

    public static getNewlineString(leading: string, trailing: string, newline?: string) {
        return leading.includes('\n') || /(?:\r?\n){2,}$/.test(trailing) ? newline ? newline : (leading + trailing).includes('\r') ? '\r\n' : '\n' : '';
    }

    public static hasInnerXml(tagName: string) {
        return !this.TAG_VOID.includes(tagName);
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

    public static splitOuterXml(tagName: string, outerXml: string): [string, string] {
        const forward = outerXml.split('>');
        const opposing = outerXml.split('<');
        if (opposing.length === 2 || forward.length === 2) {
            return XmlElement.hasInnerXml(tagName) ? [outerXml.replace(/\s*\/?\s*>$/, ''), ''] : [outerXml, ''];
        }
        else if (opposing.length === 3 && forward.length === 3 && /^<[^>]+>[\S\s]*?<\/[^>]+>$/.test(outerXml)) {
            return [forward[0] + '>', !forward[2] ? '' : forward[1].substring(0, forward[1].length - opposing[2].length)];
        }
        if (XmlElement.hasInnerXml(tagName)) {
            const closeIndex = XmlElement.findCloseTag(outerXml) + 1;
            let openTag: Undef<string>;
            if (closeIndex !== 0) {
                const lastIndex = outerXml.lastIndexOf('<');
                openTag = outerXml.substring(0, closeIndex);
                if (closeIndex < lastIndex && closeIndex < outerXml.length) {
                    return [openTag, outerXml.substring(closeIndex, lastIndex)];
                }
            }
            return [openTag || `<${tagName}>`, ''];
        }
        return [outerXml, ''];
    }

    public lowerCase = false;
    public newline = '\n';

    protected _modified = false;
    protected _tagName = '';
    protected _innerXml = '';
    protected readonly _attributes = new Map<string, Optional<string>>();

    constructor(public readonly documentName: string, public readonly node: XmlNodeTag, attributes?: StandardMap) {
        const attrs = this._attributes;
        applyAttributes(attrs, node.attributes);
        applyAttributes(attrs, attributes);
        this._modified = attrs.size > 0;
        if (node.outerXml) {
            const [tagStart, innerXml] = XmlElement.splitOuterXml(node.tagName, node.outerXml);
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
                this._innerXml = innerXml;
            }
        }
        else if (node.innerXml) {
            this._innerXml = node.innerXml;
        }
    }

    abstract get outerXml(): string;

    abstract findIndexOf(source: string, append?: boolean): FindIndexOfResult;

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
            append: Undef<TagIndex>,
            prepend: Undef<TagIndex>;
        if (options) {
            ({ remove, append, prepend } = options);
        }
        const appending = !!(append || prepend);
        let error: Optional<Error> = null;
        if (this._modified || remove || appending) {
            const element = this.node;
            const outerXml = !remove || appending ? this.outerXml : '';
            const spliceSource = (index: WriteSourceIndex) => {
                let [startIndex, endIndex, trailing = ''] = index,
                    leading = '';
                element.startIndex = startIndex;
                element.endIndex = startIndex + outerXml.length - 1;
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
            const errorResult = (message: string): [string, string, Error] => ['', '', new Error(`${tagName.toUpperCase()} ${tagIndex}: ${message}`)];
            let { startIndex, endIndex } = element;
            if (startIndex !== undefined && endIndex !== undefined) {
                return [spliceSource([startIndex, endIndex]), outerXml, error];
            }
            const id = element.id?.[this.documentName];
            if (append && !id) {
                return errorResult('Element id is missing.');
            }
            const { tagName, tagCount, tagIndex } = element;
            const foundIndex: WriteSourceIndex[] = [];
            const openTag: number[] = [];
            const selfClosed = !XmlElement.hasInnerXml(tagName);
            const selfId = selfClosed && !!id;
            const hasId = (start: number, end: number) => !!id && source.substring(start, end).includes(id);
            const getTagStart = (start: number): Null<WriteResult> => {
                const end = XmlElement.findCloseTag(source, start);
                return end !== -1 && hasId(start, end) ? [spliceSource([start, end]), outerXml, error] : null;
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
                            return errorResult(`Element ${id!} was not found.`);
                        }
                    }
                    else if (foundCount === tagCount) {
                        sourceIndex = foundIndex[tagIndex];
                    }
                }
            }
            if (!sourceIndex) {
                [startIndex, endIndex, error] = this.findIndexOf(source, !!append);
                if (startIndex !== -1 && endIndex !== -1) {
                    sourceIndex = [startIndex, endIndex];
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
                    sourceIndex[2] = XmlElement.getNewlineString(leading, trailing, this.newline);
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
        value = value.toLowerCase();
        if (value !== this.tagName) {
            this._tagName = value;
            if (!XmlElement.hasInnerXml(value)) {
                this.innerXml = '';
            }
            this._modified = true;
        }
    }
    get tagName() {
        return this._tagName ||= this.node.tagName;
    }
    get innerXml() {
        return this._innerXml;
    }
    set innerXml(value) {
        if (value !== this._innerXml) {
            this._innerXml = value;
            this._modified = true;
        }
    }
    get modified() {
        return this._modified;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { XmlWriter, XmlElement };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}