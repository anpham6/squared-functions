import type { FindElementOptions, IDomWriter, ParserResult, SourceIndex, TagOffsetMap, XmlTagNode } from './document';

import htmlparser2 = require('htmlparser2');
import domhandler = require('domhandler');
import domutils = require('domutils');

import { XmlElement, XmlWriter } from './index';

const Parser = htmlparser2.Parser;
const DomHandler = domhandler.DomHandler;

const TAG_VOID = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];
const REGEX_VOID = TAG_VOID.map(tagName => new RegExp(`(\\s*)</${tagName}\\s*>` + XmlWriter.PATTERN_TRAILINGSPACE, 'gi'));
const REGEX_NORMALIZE = new RegExp(`<(?:([^\\s]${XmlWriter.PATTERN_TAGOPEN}*?)(\\s*\\/?\\s*)|\\/([^\\s>]+)(\\s*))>`, 'gi');

const getAttrId = (document: string) => `data-${document}-id`;

export class DomWriter extends XmlWriter implements IDomWriter {
    static hasInnerXml(tagName: string) {
        return !TAG_VOID.includes(tagName);
    }

    static normalize(source: string, newline?: string) {
        for (const tag of REGEX_VOID) {
            source = source.replace(tag, (...capture) => DomWriter.getNewlineString(capture[1], capture[2], newline));
        }
        let match: Null<RegExpExecArray>;
        while (match = REGEX_NORMALIZE.exec(source)) {
            let tag: Undef<string>;
            if (match[1]) {
                if (match[2]) {
                    tag = `<${match[1]}>`;
                }
            }
            else if (match[4]) {
                tag = `</${match[3]}>`;
            }
            if (tag) {
                source = source.substring(0, match.index) + tag + source.substring(match.index + match[0].length);
                REGEX_NORMALIZE.lastIndex -= match[0].length - tag.length;
            }
        }
        REGEX_NORMALIZE.lastIndex = 0;
        return source;
    }

    static getDocumentElement(source: string): ParserResult {
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

    static findElement(source: string, node: XmlTagNode, options?: FindElementOptions) {
        let document: Undef<string>,
            id: Undef<string>;
        if (options) {
            ({ document, id } = options);
        }
        const result: ParserResult = { element: null, error: null };
        new Parser(new DomHandler((err, dom) => {
            if (!err) {
                const nodes = domutils.getElementsByTagName(node.tagName, dom, true);
                let index = -1;
                if (document && id) {
                    const documentId = getAttrId(document);
                    index = nodes.findIndex(elem => elem.attribs[documentId] === id);
                    if (index !== -1) {
                        result.element = nodes[index];
                    }
                }
                if (!result.element && nodes.length === node.tagCount) {
                    const tagIndex = node.tagIndex;
                    if (tagIndex !== undefined && (result.element = nodes[tagIndex])) {
                        index = tagIndex;
                    }
                }
                if (result.element) {
                    result.tagName = node.tagName;
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

    documentElement: Null<XmlTagNode> = null;
    readonly rootName = 'html';
    readonly ignoreTagName = 'title|style|script';
    readonly ignoreCaseTagName = true;

    constructor(documentName: string, source: string, elements: XmlTagNode[], normalize?: boolean) {
        super(documentName, source, elements);
        const items: XmlTagNode[] = [];
        let outerXml = '',
            documentElement: Undef<XmlTagNode>,
            offsetMap: Undef<TagOffsetMap>,
            startIndex = -1;
        for (const item of elements) {
            item.ignoreCase = true;
            item.tagName = item.tagName.toLowerCase();
            if (item.tagName === 'html') {
                items.push(item);
                if (!documentElement && item.innerXml) {
                    documentElement = item;
                }
            }
        }
        const html = /<html[\s>]/i.exec(source);
        if (source.includes('\r\n')) {
            this.newline = '\r\n';
        }
        if (html) {
            const endIndex = DomWriter.findCloseTag(source, html.index);
            if (endIndex !== -1) {
                startIndex = html.index;
                outerXml = source.substring(startIndex, endIndex + 1);
            }
        }
        if (documentElement) {
            let leading: string;
            if (startIndex === -1) {
                leading = '<!DOCTYPE html>' + this.newline + '<html>';
                outerXml = '<html>';
                startIndex = leading.length - outerXml.length;
            }
            else {
                leading = source.substring(0, startIndex + outerXml.length);
            }
            source = leading + this.newline + documentElement.innerXml! + this.newline + '</html>';
            this.source = source;
            this.documentElement = documentElement;
        }
        else {
            if (normalize) {
                source = DomWriter.normalize(source, this.newline);
                ++this.modifyCount;
            }
            const trailing = items.find(item => item.textContent);
            if (trailing) {
                const match = /<\/body\s*>/i.exec(source);
                if (match) {
                    const textContent = trailing.textContent!;
                    offsetMap = XmlWriter.getTagOffset(textContent);
                    source = source.substring(0, match.index) + textContent + source.substring(match.index);
                }
            }
            this.source = source;
        }
        if (outerXml) {
            const endIndex = startIndex + outerXml.length - 1;
            for (const item of items) {
                item.startIndex = startIndex;
                item.endIndex = endIndex;
                item.outerXml = outerXml;
            }
        }
        this.init(offsetMap);
    }
    newElement(node: XmlTagNode) {
        return new HtmlElement(this.documentName, node);
    }
    save() {
        if (this.modified) {
            const index = this.documentElement ? this.source.length - this.newline.length - 7 : /\s*<\/html\s*>/i.exec(this.source)?.index ?? NaN;
            if (!isNaN(index)) {
                let innerXml: Undef<string>;
                for (const item of this.elements) {
                    if (item.tagName === 'html') {
                        if (item.endIndex !== undefined && !innerXml) {
                            innerXml = this.source.substring(item.endIndex + (this.documentElement ? this.newline.length + 1 : 1), index);
                        }
                        item.innerXml = innerXml;
                    }
                }
            }
        }
        return super.save();
    }
    close() {
        this.source = this.source.replace(new RegExp(this.patternId, 'g'), '');
        return super.close();
    }
    get nameOfId() {
        return getAttrId(this.documentName);
    }
}

export class HtmlElement extends XmlElement {
    readonly TAG_VOID = TAG_VOID;

    constructor(documentName: string, node: XmlTagNode, attributes?: StandardMap) {
        super(documentName, node, attributes, TAG_VOID.includes(node.tagName));
    }

    getTagOffset(source?: string) {
        switch (this.tagName) {
            case 'html':
            case 'title':
            case 'style':
            case 'script':
                break;
            default:
                return super.getTagOffset(source);
        }
    }
    findIndexOf(source: string) {
        const { element } = DomWriter.findElement(source, this.node, { document: this.documentName, id: this.id });
        if (element) {
            return { startIndex: element.startIndex!, endIndex: element.endIndex! } as SourceIndex;
        }
    }

    get outerXml() {
        const [tagName, items, innerXml] = this.getOuterContent();
        return '<' + tagName + HtmlElement.writeAttributes(items) + '>' + (DomWriter.hasInnerXml(tagName) && tagName !== 'html' ? (tagName === 'title' ? XmlWriter.escapeXmlString(innerXml) : innerXml) + `</${tagName}>` : '');
    }
    get nameOfId() {
        return getAttrId(this.documentName);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DomWriter, HtmlElement };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}