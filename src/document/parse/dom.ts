import type { AttributeMap, FindElementOptions, FindIndexOfResult, IDomWriter, IXmlElement, ParserResult, WriteOptions, XmlNodeTag } from './document';

import htmlparser2 = require('htmlparser2');
import domhandler = require('domhandler');
import domutils = require('domutils');

import { XmlElement, XmlWriter } from './index';

const Parser = htmlparser2.Parser;
const DomHandler = domhandler.DomHandler;

const TAG_VOID = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

const formatHTML = (value: string) => value.replace(/<\s*html\b/i, '<html');
const getAttrId = (document: string) => `data-${document}-id`;

export class DomWriter extends XmlWriter implements IDomWriter {
    public static hasInnerXml(tagName: string) {
        return !TAG_VOID.includes(tagName);
    }

    public static normalize(source: string) {
        const pattern = /(?:<(\s*)((?:"[^"]*"|'[^']*'|[^"'>])+?)(\s*\/?\s*)>|<(\s*)\/([^>]+?)(\s*)>)/g;
        let match: Null<RegExpExecArray>;
        while (match = pattern.exec(source)) {
            let value: Undef<string>;
            if (match[2]) {
                if (match[1] || match[3]) {
                    value = `<${match[2]}>`;
                }
            }
            else if (match[4] || match[6]) {
                value = `</${match[5]}>`;
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

    public static findElement(source: string, node: XmlNodeTag, options?: FindElementOptions): ParserResult {
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
                if (!result.element) {
                    index = node.tagIndex;
                    if (nodes.length === node.tagCount && nodes[index]) {
                        result.element = nodes[index];
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

    public documentElement: Null<XmlNodeTag> = null;
    public readonly rootName = 'html';

    constructor(documentName: string, source: string, elements: XmlNodeTag[], normalize = true) {
        super(documentName, source, elements);
        const items = elements.filter(item => item.tagName === 'html');
        const documentElement = items.find(item => item.innerXml);
        const html = /<\s*html[\s|>]/i.exec(source);
        let outerXml = '',
            startIndex = -1;
        if (source.includes('\r\n')) {
            this.newline = '\r\n';
        }
        if (html) {
            const endIndex = XmlElement.findCloseTag(source, html.index);
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
            this.source = leading + this.newline + documentElement.innerXml! + this.newline + '</html>';
            this.documentElement = documentElement;
        }
        else {
            this.source = normalize ? DomWriter.normalize(source) : source;
        }
        if (outerXml) {
            const endIndex = startIndex + outerXml.length - 1;
            for (const item of items) {
                item.startIndex = startIndex;
                item.endIndex = endIndex;
                item.outerXml = outerXml;
            }
        }
        this.insertNodes();
    }

    newElement(node: XmlNodeTag) {
        return new HtmlElement(this.documentName, node);
    }
    write(element: IXmlElement, options?: WriteOptions) {
        if (this.documentElement) {
            element.lowerCase = true;
        }
        return super.write(element, options);
    }
    save() {
        if (this.modified) {
            const match = (this.documentElement ? /\s*<\/html>$/ : /\s*<\/\s*html\s*>/i).exec(this.source);
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
        this.source = this.source.replace(new RegExp(`\\s+${getAttrId(this.documentName)}="[^"]+"`, 'g'), '');
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
                        if (tagIndex !== -1 && this.updateByTag({ tagName: target.tagName, tagIndex, tagCount: nodes.length }, { startIndex: target.startIndex!, endIndex: target.endIndex!, outerXml })) {
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
}

export class HtmlElement extends XmlElement {
    constructor(documentName: string, node: XmlNodeTag, attributes?: StandardMap) {
        super(documentName, node, attributes, TAG_VOID);
    }

    findIndexOf(source: string): FindIndexOfResult {
        const { element: target, error } = DomWriter.findElement(source, this.node, { document: this.documentName, id: this.id });
        return target ? [target.startIndex!, target.endIndex!, error] : [-1, -1, error];
    }

    set id(value: string) {
        this.setAttribute(getAttrId(this.documentName), value);
    }
    get id() {
        return this.getAttribute(getAttrId(this.documentName)) || '';
    }
    get outerXml() {
        const append = this.node.prepend || this.node.append;
        let items: AttributeMap | [string, Optional<string>][],
            tagName: Undef<string>,
            textContent: Undef<string>;
        if (append) {
            let id: Undef<string>;
            ({ tagName, id, textContent } = append);
            const idKey = getAttrId(this.documentName);
            items = Array.from(this._attributes).filter(item => item[0] !== idKey);
            if (id) {
                items.push([idKey, id]);
            }
        }
        else {
            tagName = this.tagName;
            items = this._attributes;
        }
        let outerXml = '<' + tagName;
        for (const [key, value] of items) {
            if (value !== undefined) {
                outerXml += ' ' + key + (value !== null ? `="${value.replace(/"/g, '&quot;')}"` : '');
            }
        }
        outerXml += '>';
        if (DomWriter.hasInnerXml(tagName) && tagName !== 'html') {
            if (textContent) {
                switch (tagName) {
                    case 'script':
                    case 'style':
                        break;
                    default:
                        textContent = DomWriter.escapeXmlString(textContent);
                        break;
                }
            }
            outerXml += (textContent || this.innerXml) + `</${tagName}>`;
        }
        return outerXml;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DomWriter, HtmlElement };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}