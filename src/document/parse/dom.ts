import type { FindElementOptions, IDomWriter, ParserResult, SourceIndex, TagOffsetMap, XmlTagNode } from './document';

import htmlparser2 = require('htmlparser2');
import domhandler = require('domhandler');
import domutils = require('domutils');

import Module from '../../module';

import { XmlElement, XmlWriter } from './index';

const Parser = htmlparser2.Parser;
const DomHandler = domhandler.DomHandler;

const TAG_VOID = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

const formatHTML = (value: string) => value.replace(/<html(\s*)/i, (...capture) => '<html' + (capture[1] ? ' ' : ''));
const getAttrId = (document: string) => `data-${document}-id`;

export class DomWriter extends XmlWriter implements IDomWriter {
    static hasInnerXml(tagName: string) {
        return !TAG_VOID.includes(tagName);
    }

    static normalize(source: string) {
        for (const tag of TAG_VOID) {
            source = source.replace(new RegExp(`</${tag}\\s*>`, 'gi'), '');
        }
        const pattern = new RegExp(`<(?:([^\\s]${XmlWriter.PATTERN_TAGOPEN}*?)(\\s*\\/?\\s*)|\\/([^\\s>]+)(\\s*))>`, 'g');
        let match: Null<RegExpExecArray>;
        while (match = pattern.exec(source)) {
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
                pattern.lastIndex -= match[0].length - tag.length;
            }
        }
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

    constructor(documentName: string, source: string, elements: XmlTagNode[], normalize = true) {
        super(documentName, source, elements);
        const items: XmlTagNode[] = [];
        for (const item of elements) {
            item.lowerCase = true;
            item.tagName = item.tagName.toLowerCase();
            if (item.tagName === 'html') {
                items.push(item);
            }
        }
        const documentElement = items.find(item => item.innerXml);
        const html = /<html[\s>]/i.exec(source);
        let outerXml = '',
            offsetMap: Undef<TagOffsetMap>,
            startIndex = -1;
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
                leading = formatHTML(source.substring(0, startIndex + outerXml.length));
                outerXml = formatHTML(outerXml);
            }
            source = leading + this.newline + documentElement.innerXml! + this.newline + '</html>';
            this.source = source;
            this.documentElement = documentElement;
        }
        else {
            if (normalize) {
                source = DomWriter.normalize(source);
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
            const title = new RegExp(`<title(${XmlWriter.PATTERN_TAGOPEN}*)>([\\S\\s]*?)<\\/title\\s*>`, 'i').exec(source);
            if (title) {
                const innerXml = XmlWriter.escapeXmlString(title[5]);
                if (innerXml !== title[5]) {
                    const startIndex = title.index;
                    const titleXml = `<title${title[1]}>${innerXml}</title>`;
                    for (const item of elements) {
                        if (item.tagName === 'title') {
                            item.outerXml = titleXml;
                        }
                    }
                    this.spliceRawString({ outerXml: titleXml, startIndex, endIndex: startIndex + title[0].length - 1 }, false);
                }
            }
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
            const match = (this.documentElement ? /\s*<\/html>$/ : /\s*<\/html\s*>/i).exec(this.source);
            if (match) {
                let innerXml: Undef<string>;
                for (const item of this.elements) {
                    if (item.tagName === 'html' && item.endIndex !== undefined) {
                        item.innerXml = innerXml ||= this.source.substring(item.endIndex + (this.documentElement ? this.newline.length + 1 : 1), match.index);
                    }
                }
            }
        }
        return super.save();
    }
    close() {
        this.source = this.source.replace(new RegExp(`\\s+${Module.escapePattern(this.nameOfId)}="[^"]+"`, 'g'), '');
        return super.close();
    }
    replaceAll(predicate: (elem: domhandler.Element) => boolean, callback: (elem: domhandler.Element, source: string) => Undef<string>) {
        let result = 0;
        new Parser(new DomHandler((err, dom) => {
            if (!err) {
                for (const target of domutils.findAll(predicate, dom).reverse()) {
                    const outerXml = callback(target, this.source);
                    if (outerXml) {
                        const nodes = domutils.getElementsByTagName(target.tagName, dom, true);
                        const tagIndex = nodes.findIndex(elem => elem === target);
                        if (tagIndex !== -1) {
                            const startIndex = target.startIndex!;
                            const endIndex = target.endIndex!;
                            this.spliceRawString({ startIndex, endIndex, outerXml });
                            this.update({ id: { [this.documentName]: target.attribs[this.nameOfId] }, tagName: target.tagName, tagIndex, tagCount: nodes.length, startIndex, endIndex }, outerXml);
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