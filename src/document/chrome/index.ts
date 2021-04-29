import type { LocationUri } from '../../types/lib/squared';
import type { DataSource, MongoDataSource, RequestData, UriDataSource } from '../../types/lib/chrome';

import type { IFileManager } from '../../types/lib';
import type { FileData, OutputData } from '../../types/lib/asset';
import type { CloudDatabase } from '../../types/lib/cloud';
import type { SourceMapOutput } from '../../types/lib/document';
import type { RequestBody as IRequestBody } from '../../types/lib/node';

import type { CloudScopeOrigin } from '../../cloud';
import type { DocumentAsset, DocumentModule, IChromeDocument } from './document';

import path = require('path');
import fs = require('fs-extra');
import request = require('request-promise-native');
import yaml = require('js-yaml');
import uuid = require('uuid');

import mongodb = require('mongodb');
import jp = require('jsonpath');

import Document from '../../document';
import Cloud from '../../cloud';
import { DomWriter, HtmlElement } from '../parse/dom';

interface RequestBody extends IRequestBody, RequestData {}

const MongoClient = mongodb.MongoClient;

const REGEXP_SRCSETSIZE = /~\s*([\d.]+)\s*([wx])/i;
const REGEXP_CSSVARIABLE = new RegExp(`(\\s*)(--[^\\s:]*)\\s*:[^;}]*([;}])` + DomWriter.PATTERN_TRAILINGSPACE, 'g');
const REGEXP_CSSFONT = new RegExp(`(\\s*)@font-face\\s*{([^}]+)}` + DomWriter.PATTERN_TRAILINGSPACE, 'gi');
const REGEXP_CSSKEYFRAME = /(\s*)@keyframes\s+([^{]+){/gi;
const REGEXP_CSSCLOSING = /\s*(?:content\s*:\s*(?:"[^"]*"|'[^']*')|url\(\s*(?:"[^"]+"|'[^']+'|[^\s)]+)\s*\))/gi;
const REGEXP_TEMPLATECONDITIONAL = /(\n\s+)?\{\{\s*if\s+(!)?\s*([^}\s]+)\s*\}\}(\s*)([\S\s]*?)(?:\s*\{\{\s*else\s*\}\}(\s*)([\S\s]*?)\s*)?\s*\{\{\s*end\s*\}\}/gi;
const REGEXP_OBJECTPROPERTY = /\$\{\s*([^\s}]+)\s*\}/g;
const REGEXP_OBJECTVALUE = /([^[.\s]+)((?:\s*\[[^\]]+\]\s*)+)?\s*\.?\s*/g;
const REGEXP_OBJECTINDEX = /\[\s*(["'])?(.+?)\1\s*\]/g;

function removeDatasetNamespace(name: string, source: string, newline: string) {
    if (source.indexOf('data-' + name) !== -1) {
        return source
            .replace(new RegExp(`(\\s*)<(script|style)${DomWriter.PATTERN_TAGOPEN}+?data-${name}-file\\s*=\\s*(["'])?exclude\\3${DomWriter.PATTERN_TAGOPEN}*>[\\S\\s]*?<\\/\\2\\s*>` + DomWriter.PATTERN_TRAILINGSPACE, 'gi'), (...capture) => DomWriter.getNewlineString(capture[1], capture[4], newline))
            .replace(new RegExp(`(\\s*)<link${DomWriter.PATTERN_TAGOPEN}+?data-${name}-file\\s*=\\s*(["'])?exclude\\2${DomWriter.PATTERN_TAGOPEN}*>` + DomWriter.PATTERN_TRAILINGSPACE, 'gi'), (...capture) => DomWriter.getNewlineString(capture[1], capture[3], newline))
            .replace(new RegExp(`(\\s*)<script${DomWriter.PATTERN_TAGOPEN}+?data-${name}-template\\s*${DomWriter.PATTERN_ATTRVALUE + DomWriter.PATTERN_TAGOPEN}*>[\\S\\s]*?<\\/script\\s*>` + DomWriter.PATTERN_TRAILINGSPACE, 'gi'), (...capture) => DomWriter.getNewlineString(capture[1], capture[2], newline))
            .replace(new RegExp(`\\s+data-${name}-[a-z-]+\\s*` + DomWriter.PATTERN_ATTRVALUE, 'g'), '');
    }
    return source;
}

function getObjectValue(data: unknown, key: string) {
    REGEXP_OBJECTVALUE.lastIndex = 0;
    let found = false,
        value = data,
        index: Null<RegExpExecArray>,
        match: Null<RegExpExecArray>;
    while (match = REGEXP_OBJECTVALUE.exec(key)) {
        if (Document.isObject(value)) {
            value = value[match[1]];
            if (match[2]) {
                REGEXP_OBJECTINDEX.lastIndex = 0;
                while (index = REGEXP_OBJECTINDEX.exec(match[2])) {
                    const attr = index[1] ? index[2] : index[2].trim();
                    if (index[1] && Document.isObject(value) || /^\d+$/.test(attr) && (typeof value === 'string' || Array.isArray(value))) {
                        value = value[attr];
                    }
                    else {
                        return null;
                    }
                }
            }
            if (value !== undefined && value !== null) {
                found = true;
                continue;
            }
        }
        return null;
    }
    return found ? value : null;
}

function valueAsString(value: unknown, joinString = ' ') {
    if (value === undefined || value === null) {
        return '';
    }
    switch (typeof value) {
        case 'string':
        case 'number':
        case 'boolean':
            return value.toString();
        default:
            return Array.isArray(value) && !value.some(item => Document.isObject(item)) ? value.join(joinString) : JSON.stringify(value);
    }
}

function findClosingIndex(source: string, lastIndex: number): [number, string] {
    const pattern = /[{}]/g;
    pattern.lastIndex = lastIndex;
    let opened = 1,
        closed = 0,
        endIndex = -1,
        trailing = '',
        match: Null<RegExpExecArray>;
    while (match = pattern.exec(source)) {
        if (match[0] === '{') {
            ++opened;
        }
        else if (++closed === opened) {
            endIndex = match.index;
            let ch: string;
            while (DomWriter.isSpace(ch = source[endIndex + 1])) {
                trailing += ch;
                ++endIndex;
                if (ch === '\n') {
                    break;
                }
            }
            break;
        }
    }
    return [endIndex, trailing];
}

function removeCss(this: IChromeDocument, source: string) {
    const { usedVariables, usedFontFace, usedKeyframes, unusedStyles, unusedMedia, unusedSupports } = this;
    if (!usedVariables && !usedFontFace && !usedKeyframes && !unusedStyles && !unusedMedia && !unusedSupports) {
        return source;
    }
    const replaceMap: StringMap = {};
    let current = source,
        offset: number,
        modified: Undef<boolean>,
        checkEmpty: Undef<Set<string>>,
        match: Null<RegExpExecArray>;
    while (match = REGEXP_CSSCLOSING.exec(source)) {
        if (match[0].indexOf('}') !== -1) {
            const placeholder = uuid.v4();
            replaceMap[placeholder] = match[0];
            current = current.replace(match[0], placeholder);
        }
    }
    REGEXP_CSSCLOSING.lastIndex = 0;
    const replaceUnunsed = (items: string[], name: string) => {
        for (const value of items) {
            const pattern = new RegExp(`(\\s*)@${name}\\s+${Document.escapePattern(value.trim()).replace(/\s+/g, '\\s+')}\\s*{`, 'gi');
            while (match = pattern.exec(current)) {
                const startIndex = match.index;
                const [endIndex, trailing] = findClosingIndex(current, startIndex + match[0].length);
                if (endIndex !== -1) {
                    [current, offset] = spliceString(current, startIndex, endIndex, match[1], trailing);
                    modified = true;
                    (checkEmpty ||= new Set()).add(name);
                    pattern.lastIndex = startIndex + offset;
                }
            }
        }
    };
    const removeEmpty = (name: string) => {
        const pattern = new RegExp(`(\\s*)@${name}\\s*[^{]*{\\s*}` + DomWriter.PATTERN_TRAILINGSPACE, 'gi');
        while (match = pattern.exec(current)) {
            const startIndex = match.index;
            [current, offset] = spliceString(current, startIndex, startIndex + match[0].length - 1, match[1], match[2]);
            pattern.lastIndex = startIndex + offset;
        }
    };
    if (unusedMedia) {
        replaceUnunsed(unusedMedia, 'media');
    }
    if (unusedSupports) {
        replaceUnunsed(unusedSupports, 'supports');
    }
    if (unusedStyles) {
        for (let value of unusedStyles) {
            const block = `(\\s*)${value = Document.escapePattern(value).replace(/\s+/g, '\\s+')}\\s*\\{[^}]*\\}` + DomWriter.PATTERN_TRAILINGSPACE;
            for (let i = 0; i < 2; ++i) {
                const pattern = new RegExp(`(${i === 0 ? '^' : '[{}]'})` + block, i === 0 ? 'm' : 'g');
                while (match = pattern.exec(current)) {
                    const startIndex = match.index;
                    [current, offset] = spliceString(current, startIndex, startIndex + match[0].length - 1, match[2], match[3], i === 0 ? '' : match[1]);
                    modified = true;
                    if (i === 0) {
                        break;
                    }
                    pattern.lastIndex = startIndex + offset;
                }
            }
            const pattern = new RegExp(`([{}]?[^,{}]*?)((,?\\s*)${value}\\s*[,{](\\s*)).*?\\{?`, 'g');
            while (match = pattern.exec(current)) {
                const segment = match[2];
                let outerXml = '';
                if (segment.trim().endsWith('{')) {
                    outerXml = ' {' + match[4];
                }
                else if (segment[0] === ',') {
                    outerXml = ', ';
                }
                else {
                    switch (match[1].trim()) {
                        case '{':
                        case '}':
                            if (match[3] && !match[3].trim()) {
                                outerXml = match[3];
                            }
                            break;
                    }
                }
                const startIndex = match.index;
                [current, offset] = spliceString(current, startIndex, startIndex + match[0].length - 1, '', '', match[0].replace(segment, outerXml));
                modified = true;
                pattern.lastIndex = startIndex + offset;
            }
        }
    }
    if (usedVariables) {
        while (match = REGEXP_CSSVARIABLE.exec(current)) {
            if (!usedVariables.includes(match[2])) {
                const startIndex = match.index;
                [current, offset] = spliceString(current, startIndex, startIndex + match[0].length - 1, '', '', match[3] === ';' ? DomWriter.getNewlineString(match[1], match[4]) : '');
                modified = true;
                REGEXP_CSSVARIABLE.lastIndex = startIndex + offset;
            }
        }
        REGEXP_CSSVARIABLE.lastIndex = 0;
    }
    if (usedFontFace) {
        const fonts = usedFontFace.map(value => value.toLowerCase());
        while (match = REGEXP_CSSFONT.exec(current)) {
            const font = /font-family\s*:([^;}]+)/i.exec(match[0]);
            if (font && !fonts.includes(font[1].trim().replace(/^(["'])(.+)\1$/, (...content) => content[2]).toLowerCase())) {
                const startIndex = match.index;
                [current, offset] = spliceString(current, startIndex, startIndex + match[0].length - 1, match[1], match[3]);
                modified = true;
                REGEXP_CSSFONT.lastIndex = startIndex + offset;
            }
        }
        REGEXP_CSSFONT.lastIndex = 0;
    }
    if (usedKeyframes) {
        while (match = REGEXP_CSSKEYFRAME.exec(current)) {
            if (!usedKeyframes.includes(match[2].trim())) {
                const startIndex = match.index;
                const [endIndex, trailing] = findClosingIndex(current, startIndex + match[0].length);
                if (endIndex !== -1) {
                    [current, offset] = spliceString(current, startIndex, endIndex, match[1], trailing);
                    modified = true;
                    REGEXP_CSSKEYFRAME.lastIndex = startIndex + offset;
                }
            }
        }
        REGEXP_CSSKEYFRAME.lastIndex = 0;
    }
    if (modified) {
        if (checkEmpty) {
            for (const name of checkEmpty) {
                removeEmpty(name);
            }
        }
        for (const attr in replaceMap) {
            current = current.replace(attr, replaceMap[attr]!);
        }
        return current;
    }
    return source;
}

function getRelativeUri(this: IFileManager, cssFile: DocumentAsset, asset: DocumentAsset) {
    if (cssFile.inlineContent) {
        return asset.relativeUri!;
    }
    let fileDir = cssFile.pathname,
        assetDir = asset.pathname;
    if (fileDir === assetDir && (cssFile.moveTo || '') === (asset.moveTo || '')) {
        return asset.filename;
    }
    if (cssFile.moveTo) {
        if (cssFile.moveTo === asset.moveTo) {
            assetDir = Document.joinPath(asset.moveTo, asset.pathname);
        }
        else {
            const moveUri = path.join(this.baseDirectory, cssFile.moveTo, asset.relativeUri!);
            try {
                if (!fs.existsSync(moveUri)) {
                    fs.mkdirpSync(path.dirname(moveUri));
                    fs.copyFileSync(asset.localUri!, moveUri);
                }
            }
            catch (err) {
                this.writeFail(['Unable to copy file', path.basename(moveUri)], err, this.logType.FILE);
            }
        }
        fileDir = Document.joinPath(cssFile.moveTo, cssFile.pathname);
    }
    const splitPath = (value: string) => value.split(/[\\/]/).filter(segment => segment.trim());
    const prefix = splitPath(fileDir);
    const suffix = splitPath(assetDir);
    let found: Undef<boolean>;
    while (prefix.length && suffix.length && prefix[0] === suffix[0]) {
        prefix.shift();
        suffix.shift();
        found = true;
    }
    return found ? Document.joinPath('../'.repeat(prefix.length), suffix.join('/'), asset.filename) : '../'.repeat(prefix.length) + asset.relativeUri!;
}

function trimQuote(value: string) {
    const first = value[0];
    const last = value[value.length - 1];
    return first === last && (first === '"' || first === "'") ? value.substring(1, value.length - 1) : value;
}

function transformCss(this: IFileManager, assets: DocumentAsset[], cssFile: DocumentAsset, source: string, fromHTML?: boolean) {
    const cloud = this.Cloud;
    const cssUri = cssFile.uri!;
    const related: DocumentAsset[] = [];
    const length = source.length;
    const pattern = /\burl\(/gi;
    let output: Undef<string>,
        match: Null<RegExpExecArray>;
    while (match = pattern.exec(source)) {
        let url = '',
            quote = '',
            i = match.index + match[0].length,
            j = -1;
        for ( ; i < length; ++i) {
            const ch = source[i];
            if (!quote && (ch === '"' || ch === "'") && !url.trim()) {
                quote = ch;
            }
            if (ch === ')') {
                if (source[i - 1] !== '\\') {
                    break;
                }
                j = i;
            }
            else if (j !== -1 && (!fromHTML && /[:;}]/.test(ch) || fromHTML && /["':;>]/.test(ch))) {
                i = j;
                break;
            }
            url += ch;
        }
        const setOutputUrl = (asset: DocumentAsset, value: string) => {
            if (cloud?.getStorage('upload', asset.cloudStorage)) {
                if (fromHTML) {
                    value = asset.inlineCloud ||= uuid.v4();
                }
                else {
                    const inlineCssCloud = asset.inlineCssCloud ||= uuid.v4();
                    (cssFile.inlineCssMap ||= {})[inlineCssCloud] ||= value;
                    value = inlineCssCloud;
                }
            }
            output = (output || source).replace(source.substring(match!.index, i + 1), 'url(' + quote + value + quote + ')');
            related.push(asset);
        };
        url = trimQuote(url);
        if (url.startsWith('data:')) {
            const base64 = url.split(',')[1];
            for (const item of assets) {
                if (item.base64 === base64) {
                    setOutputUrl(item, getRelativeUri.call(this, cssFile, item));
                    break;
                }
            }
        }
        else {
            const asset = this.findAsset(Document.resolvePath(url, cssUri)) as Undef<DocumentAsset>;
            if (asset && !asset.invalid) {
                if (asset.format === 'base64') {
                    url = asset.inlineBase64 ||= uuid.v4();
                }
                else if (!Document.isFileHTTP(url) || Document.hasSameOrigin(cssUri, url)) {
                    url = getRelativeUri.call(this, cssFile, asset);
                }
                else {
                    const pathname = cssFile.pathname;
                    const count = pathname && pathname !== '/' ? pathname.split(/[\\/]/).length : 0;
                    url = (count ? '../'.repeat(count) : '') + asset.relativeUri;
                }
                setOutputUrl(asset, url);
            }
        }
    }
    if (!fromHTML && cssFile.watch) {
        if (!Document.isObject(cssFile.watch)) {
            cssFile.watch = {};
        }
        cssFile.watch.assets = related;
    }
    return output || source;
}

function setElementAttribute(this: IChromeDocument, htmlFile: DocumentAsset, asset: DocumentAsset, element: HtmlElement, value: string) {
    switch (element.tagName) {
        case 'a':
        case 'area':
        case 'base':
        case 'link':
            element.setAttribute('href', value);
            break;
        case 'object':
            element.setAttribute('data', value);
            break;
        case 'video':
            element.setAttribute('poster', value);
            break;
        case 'img':
        case 'source': {
            const srcset = element.getAttribute('srcset');
            if (srcset) {
                const baseUri = htmlFile.uri!;
                const uri = Document.toPosix(asset.uri);
                const src = [uri];
                const sameOrigin = Document.hasSameOrigin(baseUri, uri);
                if (sameOrigin) {
                    let url = element.getAttribute('src');
                    if (url && uri === Document.resolvePath(url = Document.toPosix(url), baseUri)) {
                        src.push(url);
                    }
                    url = uri.startsWith(this.baseDirectory) ? uri.substring(this.baseDirectory.length) : uri.replace(new URL(baseUri).origin, '');
                    if (!src.includes(url)) {
                        src.push(url);
                    }
                }
                let current = srcset,
                    match: Null<RegExpExecArray>;
                for (const url of src) {
                    const resolve = sameOrigin && !Document.isFileHTTP(url);
                    const pathname = escapePosix(url);
                    const pattern = new RegExp(`(,?\\s*)(${(resolve && url[0] !== '.' ? `(?:\\.\\.[\\\\/])*\\.\\.${pathname}|` : '') + pathname})([^,]*)`, 'g');
                    while (match = pattern.exec(srcset)) {
                        if (!resolve || uri === Document.resolvePath(match[2], baseUri)) {
                            current = current.replace(match[0], match[1] + value + match[3]);
                        }
                    }
                }
                element.setAttribute('srcset', current);
                if (asset.format === 'srcset') {
                    break;
                }
            }
        }
        default:
            element.setAttribute('src', value);
            break;
    }
}

function spliceString(source: string, startIndex: number, endIndex: number, leading = '', trailing = '', content = ''): [string, number] {
    if (leading || trailing) {
        content += DomWriter.getNewlineString(leading, trailing);
    }
    return [source.substring(0, startIndex) + content + source.substring(endIndex + 1), content.length];
}

const isRemoved = (item: DocumentAsset) => item.exclude === true || item.bundleIndex !== undefined && item.bundleIndex > 0;
const concatString = (values: Undef<string[]>): string => values ? values.reduce((a, b) => a + '\n' + b, '') : '';
const escapePosix = (value: string) => value.split(/[\\/]/).map(seg => Document.escapePattern(seg)).join('[\\\\/]');
const getErrorDOM = (tagName: string, tagIndex: Undef<number>) => new Error(tagName.toUpperCase() + (tagIndex !== undefined && tagIndex >= 0 ? ' -> ' + tagIndex : '') + ' (Unable to parse DOM)');

class ChromeDocument extends Document implements IChromeDocument {
    static async using(this: IFileManager, instance: ChromeDocument, file: DocumentAsset) {
        const { localUri, format, mimeType } = file;
        switch (mimeType) {
            case 'text/html':
                if (format) {
                    const result = await instance.transform('html', this.getUTF8String(file, localUri), format);
                    if (result) {
                        file.sourceUTF8 = result.code;
                    }
                }
                break;
            case 'text/css':
                if (format) {
                    const result = await instance.transform('css', this.getUTF8String(file, localUri), format);
                    if (result) {
                        if (result.map) {
                            const uri = Document.writeSourceMap(localUri!, result as SourceMapOutput);
                            if (uri) {
                                this.add(uri, file);
                            }
                        }
                        file.sourceUTF8 = result.code;
                    }
                }
                break;
            case 'text/javascript': {
                const trailing = concatString(file.trailingContent);
                const bundle = this.getAssetContent(file);
                if (!bundle && !trailing && !format) {
                    break;
                }
                let source = this.getUTF8String(file, localUri) + trailing;
                if (bundle) {
                    source += bundle;
                }
                if (format) {
                    const result = await instance.transform('js', source, format);
                    if (result) {
                        if (result.map) {
                            const uri = Document.writeSourceMap(localUri!, result as SourceMapOutput);
                            if (uri) {
                                this.add(uri, file);
                            }
                        }
                        source = result.code;
                    }
                }
                file.sourceUTF8 = source;
                break;
            }
            case '@text/html': {
                const items = instance.assets.filter(item => item.format === 'base64' && item.element);
                if (items.length) {
                    const domBase = new DomWriter(instance.moduleName, this.getUTF8String(file, localUri), this.getElements(), instance.normalizeHtmlOutput);
                    for (const item of items) {
                        const element = item.element!;
                        const domElement = new HtmlElement(instance.moduleName, element, item.attributes);
                        setElementAttribute.call(instance, file, item, domElement, item.inlineBase64 ||= uuid.v4());
                        if (domBase.write(domElement)) {
                            item.watch = false;
                        }
                        else {
                            this.writeFail('Element attribute replacement', getErrorDOM(element.tagName, element.tagIndex));
                            delete item.inlineBase64;
                        }
                    }
                    if (domBase.modified) {
                        file.sourceUTF8 = domBase.save();
                    }
                }
                break;
            }
            case '@text/css': {
                const bundle = this.getAssetContent(file);
                let source = this.getUTF8String(file, localUri) + concatString(file.trailingContent);
                if (bundle) {
                    source += bundle;
                }
                file.sourceUTF8 = transformCss.call(
                    this,
                    this.getDocumentAssets(instance),
                    file,
                    !file.preserve ? removeCss.call(instance, source) : source
                );
                break;
            }
        }
    }

    static async finalize(this: IFileManager, instance: IChromeDocument) {
        const { moduleName, htmlFile } = instance;
        const inlineMap = new Set<DocumentAsset>();
        const base64Map: StringMap = {};
        const elements: DocumentAsset[] = [];
        const replaceContent = (source: string) => {
            for (const id in base64Map) {
                source = source.replace(new RegExp(Document.escapePattern(id), 'g'), base64Map[id]!);
            }
            if (instance.productionRelease) {
                source = instance.removeServerRoot(source);
            }
            return source;
        };
        for (const item of instance.assets) {
            if (item.inlineBase64) {
                try {
                    base64Map[item.inlineBase64] = `data:${item.mimeType!};base64,${(item.buffer ? item.buffer.toString('base64') : fs.readFileSync(item.localUri!, 'base64')).trim()}`;
                    this.removeAsset(item);
                }
                catch (err) {
                    this.writeFail(['Unable to read file', path.basename(item.localUri!)], err, this.logType.FILE);
                }
            }
            if (htmlFile && item.element && item.format !== 'base64') {
                elements.push(item);
            }
        }
        for (const css of instance.cssFiles) {
            if (instance.productionRelease) {
                const inlineCssMap = css.inlineCssMap;
                if (inlineCssMap) {
                    for (const id in inlineCssMap) {
                        inlineCssMap[id] = instance.removeServerRoot(inlineCssMap[id]!).replace(/^\//, '');
                    }
                }
            }
            let source = replaceContent(this.getUTF8String(css, css.localUri));
            if (css.format) {
                const result = await instance.transform('css', source, css.format);
                if (result) {
                    if (result.map) {
                        const uri = Document.writeSourceMap(css.localUri!, result as SourceMapOutput);
                        if (uri) {
                            this.add(uri, css);
                        }
                    }
                    source = result.code;
                }
            }
            css.sourceUTF8 = source;
        }
        if (htmlFile) {
            const localUri = htmlFile.localUri!;
            this.formatMessage(this.logType.PROCESS, 'HTML', ['Rewriting content...', path.basename(localUri)]);
            const time = Date.now();
            const cloud = this.Cloud;
            let source = this.getUTF8String(htmlFile, localUri);
            const domBase = new DomWriter(moduleName, source, this.getElements(), instance.normalizeHtmlOutput);
            for (const item of elements) {
                const element = item.element!;
                if (element.removed || isRemoved(item)) {
                    continue;
                }
                const { attributes, srcSet, bundleIndex, inlineContent } = item;
                const crossorigin = item.format === 'crossorigin';
                let uri = item.relativeUri;
                if (!attributes && element.textContent === undefined && (item === htmlFile || !inlineContent && !srcSet && (!uri && bundleIndex === undefined || crossorigin))) {
                    continue;
                }
                const domElement = new HtmlElement(moduleName, element, attributes);
                if (inlineContent) {
                    domElement.tagName = inlineContent;
                    domElement.innerXml = this.getUTF8String(item).trim();
                    domElement.removeAttribute('src', 'href');
                }
                else if (uri && !crossorigin && item !== htmlFile) {
                    if (cloud?.getStorage('upload', item.cloudStorage)) {
                        uri = uuid.v4();
                        item.inlineCloud = uri;
                    }
                    if (bundleIndex === 0 || bundleIndex === -1) {
                        switch (element.tagName) {
                            case 'style':
                                domElement.tagName = 'link';
                            case 'link':
                                domElement.setAttribute('rel', 'stylesheet');
                                break;
                        }
                        domElement.innerXml = '';
                    }
                    setElementAttribute.call(instance, htmlFile, item, domElement, uri);
                    if (srcSet) {
                        const length = srcSet.length;
                        let src = domElement.getAttribute('srcset'),
                            i = 0;
                        while (i < length) {
                            src += (src ? ', ' : '') + srcSet[i++] + ' ' + srcSet[i++];
                        }
                        domElement.setAttribute('srcset', src);
                    }
                }
                if (!domBase.write(domElement)) {
                    this.writeFail(inlineContent ? 'Inline tag replacement' : 'Element attribute replacement', getErrorDOM(element.tagName, element.tagIndex));
                    delete item.inlineCloud;
                }
                else if (inlineContent) {
                    inlineMap.add(item);
                    item.watch = false;
                }
            }
            const dataSource = this.getDataSourceItems(instance).filter(item => item.element) as DataSource[];
            if (dataSource.length) {
                const cacheKey = uuid.v4();
                const cacheData: ObjectMap<Optional<PlainObject[] | string>> = {};
                const dataItems: DataSource[] = [];
                const displayItems: DataSource[] = [];
                for (const item of dataSource) {
                    if (item.type === 'display') {
                        displayItems.push(item);
                    }
                    else {
                        dataItems.push(item);
                    }
                }
                for (const db of [dataItems, displayItems]) {
                    await Document.allSettled(db.map(item => {
                        return new Promise<void>(async (resolve, reject) => {
                            const { element, limit, index } = item;
                            const domElement = new HtmlElement(moduleName, element!);
                            const removeElement = () => {
                                if (item.removeEmpty) {
                                    domElement.remove = true;
                                    if (!domBase.write(domElement)) {
                                        this.writeFail('Unable to remove element', getErrorDOM(element!.tagName, element!.tagIndex));
                                    }
                                }
                            };
                            let result: PlainObject[] = [];
                            switch (item.source) {
                                case 'cloud':
                                    if (cloud) {
                                        result = await cloud.getDatabaseRows(item as CloudDatabase, cacheKey).catch(err => {
                                            if (err instanceof Error && err.message) {
                                                this.errors.push(err.message);
                                            }
                                            return [];
                                        }) as PlainObject[];
                                    }
                                    break;
                                case 'mongodb': {
                                    let { name, table, query, credential, uri, options = {} } = item as MongoDataSource; // eslint-disable-line prefer-const
                                    if ((credential || uri) && name && table) {
                                        const key = JSON.stringify(credential || uri) + name + table + (query ? JSON.stringify(query) : '') + (limit || '') + (Object.keys(options).length ? JSON.stringify(options) : '');
                                        if (key in cacheData) {
                                            result = cacheData[key] as PlainObject[];
                                        }
                                        else {
                                            let client: Null<mongodb.MongoClient> = null;
                                            try {
                                                if (typeof credential === 'string') {
                                                    credential = instance.module.settings?.mongodb?.[credential] as Undef<StandardMap>;
                                                }
                                                if (credential?.server) {
                                                    const { authMechanism = '', authMechanismProperties, user, dnsSrv } = credential;
                                                    let authSource = credential.authSource;
                                                    uri = `mongodb${dnsSrv ? '+srv' : ''}://` + (user ? encodeURIComponent(user) + (authMechanism !== 'GSSAPI' && credential.pwd ? ':' + encodeURIComponent(credential.pwd) : '') + '@' : '') + credential.server + '/?authMechanism=' + encodeURIComponent(authMechanism);
                                                    switch (authMechanism) {
                                                        case 'MONGODB-X509': {
                                                            const { sslKey, sslCert, sslValidate } = credential;
                                                            if (sslKey && sslCert && path.isAbsolute(sslKey) && path.isAbsolute(sslCert) && fs.existsSync(sslKey) && fs.existsSync(sslCert)) {
                                                                options.sslKey = fs.readFileSync(sslKey);
                                                                options.sslCert = fs.readFileSync(sslCert);
                                                                if (typeof sslValidate === 'boolean') {
                                                                    options.sslValidate = sslValidate;
                                                                }
                                                                uri += '&ssl=true';
                                                            }
                                                            else {
                                                                reject(new Error('Data source -> Missing SSL credentials (MongoDB)'));
                                                                return;
                                                            }
                                                            break;
                                                        }
                                                        case 'GSSAPI':
                                                            uri += '&gssapiServiceName=mongodb';
                                                        case 'PLAIN':
                                                        case 'MONGODB-AWS':
                                                            authSource ||= '$external';
                                                            break;
                                                    }
                                                    if (authSource) {
                                                        uri += '&authSource=' + encodeURIComponent(authSource);
                                                    }
                                                    if (authMechanismProperties) {
                                                        uri += '&authMechanismProperties=' + encodeURIComponent(authMechanismProperties);
                                                    }
                                                }
                                                else {
                                                    reject(new Error('Data source -> Invalid credentials (MongoDB)'));
                                                    return;
                                                }
                                                options.useUnifiedTopology = true;
                                                client = await new MongoClient(uri, options).connect();
                                                const collection = client.db(name).collection(table);
                                                if (query) {
                                                    const checkString = (value: string) => {
                                                        let match = /^\$date\s*=\s*(.+)$/.exec(value = value.trim());
                                                        if (match) {
                                                            return new Date(match[1]);
                                                        }
                                                        if (match = /^\$regex\s*=\s*\/(.+)\/([gimsuy]*)$/.exec(value)) {
                                                            return new RegExp(match[1], match[2]);
                                                        }
                                                        return (match = /^\$function\s*=\s*(.+)$/.exec(value)) ? Document.parseFunction(match[1]) : value;
                                                    };
                                                    (function recurse(data: PlainObject) {
                                                        for (const attr in data) {
                                                            const value = data[attr];
                                                            if (typeof value === 'string') {
                                                                data[attr] = checkString(value);
                                                            }
                                                            else if (Document.isObject(value)) {
                                                                recurse(value);
                                                            }
                                                            else if (Array.isArray(value)) {
                                                                (function iterate(items: any[]) {
                                                                    for (let i = 0; i < items.length; ++i) {
                                                                        if (typeof items[i] === 'string') {
                                                                            items[i] = checkString(items[i]);
                                                                        }
                                                                        else if (Document.isObject(value)) {
                                                                            recurse(value);
                                                                        }
                                                                        else if (Array.isArray(items[i])) {
                                                                            iterate(items[i]);
                                                                        }
                                                                    }
                                                                })(value);
                                                            }
                                                        }
                                                    })(query);
                                                }
                                                result = limit === 1 && query ? [await collection.findOne(query)] : await collection.find(query).toArray();
                                                cacheData[key] = result;
                                            }
                                            catch (err) {
                                                this.writeFail(['Unable to execute MongoDB query', name + ':' + table], err);
                                            }
                                            if (client) {
                                                try {
                                                    await client.close();
                                                }
                                                catch {
                                                }
                                            }
                                        }
                                    }
                                    else if (!credential && !uri) {
                                        reject(new Error('Data source -> Missing URI connection string (MongoDB)'));
                                        return;
                                    }
                                    break;
                                }
                                case 'uri': {
                                    const { uri, query, format = path.extname(uri).substring(1) } = item as UriDataSource;
                                    let content: Optional<string>;
                                    if (Document.isFileHTTP(uri)) {
                                        if (uri in cacheData) {
                                            content = cacheData[uri] as Undef<string>;
                                        }
                                        else {
                                            content = await request(uri).catch(err => {
                                                this.writeFail(['Unable to request URL data source', uri], err);
                                                return null;
                                            });
                                            cacheData[uri] = content;
                                        }
                                    }
                                    else {
                                        const pathname = Document.resolveUri(uri);
                                        if (pathname in cacheData) {
                                            content = cacheData[pathname] as Undef<string>;
                                        }
                                        else {
                                            try {
                                                if (fs.existsSync(pathname) && (Document.isFileUNC(pathname) ? this.permission.hasUNCRead(pathname) : this.permission.hasDiskRead(pathname))) {
                                                    content = fs.readFileSync(pathname, 'utf8');
                                                    cacheData[pathname] = content;
                                                }
                                                else {
                                                    removeElement();
                                                    reject(new Error(`Data source -> No read permission (${uri})`));
                                                    return;
                                                }
                                            }
                                            catch (err) {
                                                this.writeFail(['Unable to read file', path.basename(pathname)], err, this.logType.FILE);
                                            }
                                        }
                                    }
                                    if (content) {
                                        let data: Undef<unknown>;
                                        try {
                                            switch (format) {
                                                case 'js':
                                                case 'json':
                                                case 'jsonp':
                                                case 'jsonld':
                                                case 'mjs':
                                                    data = JSON.parse(content);
                                                    break;
                                                case 'yml':
                                                case 'yaml':
                                                    data = yaml.load(content);
                                                    break;
                                                case 'toml':
                                                    data = require('toml').parse(content); // eslint-disable-line @typescript-eslint/no-unsafe-call
                                                    break;
                                                default:
                                                    removeElement();
                                                    reject(new Error(`Data source -> Format invalid (${format})`));
                                                    return;
                                            }
                                        }
                                        catch (err) {
                                            this.writeFail(['Unable to load data source', format], err);
                                            removeElement();
                                            resolve();
                                            return;
                                        }
                                        if (data && query) {
                                            data = jp.query(data, query, limit);
                                        }
                                        if (Array.isArray(data)) {
                                            result = data;
                                        }
                                        else if (Document.isObject(data)) {
                                            result = [data];
                                        }
                                        else {
                                            removeElement();
                                            reject(new Error(`Data source -> URI invalid (${uri})`));
                                            return;
                                        }
                                    }
                                    else {
                                        removeElement();
                                        if (content !== null) {
                                            reject(new Error(`Data source -> Empty response (${uri})`));
                                        }
                                        else {
                                            resolve();
                                        }
                                        return;
                                    }
                                    break;
                                }
                                default:
                                    removeElement();
                                    reject(new Error(`Data source -> Invalid (${item.source ? item.source : 'Unknown'})`));
                                    return;
                            }
                            if (index !== undefined) {
                                const data = result[index];
                                result = data ? [data] : [];
                            }
                            else if (limit !== undefined && result.length > limit) {
                                result.length = limit;
                            }
                            if (result.length) {
                                let template = item.value || element!.textContent || domElement.innerXml,
                                    errors: Undef<boolean>;
                                const isTruthy = (data: PlainObject, attr: string, falsey: Undef<string | boolean>) => {
                                    const value = !!getObjectValue(data, attr);
                                    return falsey ? !value : value;
                                };
                                switch (item.type) {
                                    case 'text':
                                        if (typeof template === 'string' && !domElement.tagVoid) {
                                            let innerXml = '';
                                            if (item.viewEngine) {
                                                const content = await instance.parseTemplate(item.viewEngine, template, result);
                                                if (content !== null) {
                                                    innerXml = content;
                                                }
                                                else {
                                                    ++domBase.failCount;
                                                    removeElement();
                                                    resolve();
                                                    return;
                                                }
                                            }
                                            else {
                                                let match: Null<RegExpExecArray>;
                                                for (let i = 0; i < result.length; ++i) {
                                                    const row = result[i];
                                                    let segment = template;
                                                    while (match = REGEXP_OBJECTPROPERTY.exec(template)) {
                                                        segment = segment.replace(match[0], match[0] === '${__index__}' ? (i + 1).toString() : valueAsString(getObjectValue(row, match[1])));
                                                    }
                                                    const current = segment;
                                                    while (match = REGEXP_TEMPLATECONDITIONAL.exec(current)) {
                                                        const col = isTruthy(row, match[3], match[2]) ? 5 : 7;
                                                        segment = segment.replace(match[0], match[col] ? (match[col - 1].indexOf('\n') !== -1 ? '' : match[1]) + match[col - 1] + match[col] : '');
                                                    }
                                                    innerXml += segment;
                                                    REGEXP_OBJECTPROPERTY.lastIndex = 0;
                                                    REGEXP_TEMPLATECONDITIONAL.lastIndex = 0;
                                                }
                                            }
                                            domElement.innerXml = innerXml;
                                        }
                                        else {
                                            errors = true;
                                        }
                                        break;
                                    case 'attribute':
                                        if (Document.isObject(template)) {
                                            for (const attr in template) {
                                                let segment = template[attr],
                                                    value = '',
                                                    valid: Undef<boolean>;
                                                if (item.viewEngine) {
                                                    if (Document.isString(segment)) {
                                                        const content = await instance.parseTemplate(item.viewEngine, segment, result);
                                                        if (content !== null) {
                                                            value = content;
                                                            valid = true;
                                                        }
                                                        else {
                                                            errors = true;
                                                            continue;
                                                        }
                                                    }
                                                    else {
                                                        errors = true;
                                                        continue;
                                                    }
                                                }
                                                else {
                                                    if (Document.isString(segment)) {
                                                        segment = [segment];
                                                    }
                                                    else if (!Array.isArray(segment)) {
                                                        errors = true;
                                                        continue;
                                                    }
                                                    let joinString = ' ';
                                                    for (const row of result) {
                                                        for (let seg of segment as string[]) {
                                                            seg = seg.trim();
                                                            if (seg[0] === ':') {
                                                                const join = /^:join\((.*)\)$/.exec(seg);
                                                                if (join) {
                                                                    joinString = join[1];
                                                                }
                                                                continue;
                                                            }
                                                            const match = REGEXP_TEMPLATECONDITIONAL.exec(seg);
                                                            if (match) {
                                                                seg = (isTruthy(row, match[3], match[2]) ? match[5] : match[7] || '').trim();
                                                                valid = true;
                                                            }
                                                            if (seg) {
                                                                const text = seg[0] === ':' && /^:text\((.*)\)$/.exec(seg);
                                                                if (text) {
                                                                    value += (value ? joinString : '') + text[1];
                                                                    valid = true;
                                                                }
                                                                else {
                                                                    const data = getObjectValue(row, seg);
                                                                    if (data !== null) {
                                                                        if (seg = valueAsString(data, joinString)) {
                                                                            value += (value ? joinString : '') + seg;
                                                                        }
                                                                        valid = true;
                                                                    }
                                                                }
                                                            }
                                                            REGEXP_TEMPLATECONDITIONAL.lastIndex = 0;
                                                        }
                                                    }
                                                }
                                                if (valid) {
                                                    domElement.setAttribute(attr, value);
                                                }
                                                else {
                                                    errors = true;
                                                }
                                            }
                                        }
                                        else {
                                            errors = true;
                                        }
                                        break;
                                    case 'display':
                                        if (item.value) {
                                            if (item.viewEngine) {
                                                errors = true;
                                                if (Document.isString(template)) {
                                                    const content = await instance.parseTemplate(item.viewEngine, template, result);
                                                    if (content !== null) {
                                                        if (content.trim() === '') {
                                                            domElement.remove = true;
                                                        }
                                                        errors = false;
                                                    }
                                                }
                                            }
                                            else {
                                                if (Document.isString(template)) {
                                                    template = [template];
                                                }
                                                if (!Array.isArray(template) || template.length === 0) {
                                                    errors = true;
                                                }
                                                else {
                                                    let remove = true;
                                                    complete: {
                                                        const row = result[0];
                                                        let condition = NaN;
                                                        for (let seg of template) {
                                                            switch ((seg = seg.trim()).toLowerCase()) {
                                                                case ':is(and)':
                                                                    if (condition === 0) {
                                                                        remove = false;
                                                                        break complete;
                                                                    }
                                                                    condition = NaN;
                                                                    continue;
                                                                case ':is(or)':
                                                                    if (isNaN(condition)) {
                                                                        condition = 0;
                                                                    }
                                                                    continue;
                                                                default:
                                                                    if (condition > 0) {
                                                                        continue;
                                                                    }
                                                                    break;
                                                            }
                                                            const match = REGEXP_TEMPLATECONDITIONAL.exec(seg);
                                                            if (match) {
                                                                seg = (isTruthy(row, match[3], match[2]) ? match[5] : match[7] || '').trim();
                                                            }
                                                            let keep = true,
                                                                sign: Undef<string>;
                                                            switch (seg[0]) {
                                                                case '-':
                                                                case '+':
                                                                    sign = seg[0];
                                                                    seg = seg.substring(1);
                                                                    break;
                                                            }
                                                            const value = getObjectValue(row, seg);
                                                            if (value === undefined || value === null) {
                                                                if (sign !== '+') {
                                                                    keep = false;
                                                                }
                                                            }
                                                            else {
                                                                switch (sign) {
                                                                    case '-':
                                                                        if (!value) {
                                                                            keep = false;
                                                                        }
                                                                        break;
                                                                    case '+':
                                                                        if (value) {
                                                                            keep = false;
                                                                        }
                                                                        break;
                                                                }
                                                            }
                                                            if (!isNaN(condition)) {
                                                                if (!keep) {
                                                                    ++condition;
                                                                }
                                                            }
                                                            else if (keep) {
                                                                remove = false;
                                                                break;
                                                            }
                                                        }
                                                        if (condition === 0) {
                                                            remove = false;
                                                        }
                                                    }
                                                    if (remove) {
                                                        domElement.remove = true;
                                                    }
                                                }
                                            }
                                            if (errors && item.removeEmpty) {
                                                domElement.remove ||= true;
                                            }
                                        }
                                        if (!domElement.remove) {
                                            resolve();
                                            return;
                                        }
                                        break;
                                    default:
                                        removeElement();
                                        reject(new Error(`Data source -> Invalid action (${item.type ? item.type : 'Unknown'})`));
                                        return;
                                }
                                if (!domBase.write(domElement) || errors) {
                                    this.writeFail(item.type === 'display' ? errors && domElement.remove ? 'Element was removed with errors' : 'Unable to remove element' : 'Unable to replace ' + item.type, getErrorDOM(element!.tagName, element!.tagIndex));
                                }
                            }
                            else {
                                if (item.type === 'display') {
                                    item.removeEmpty = true;
                                }
                                else {
                                    switch (item.source) {
                                        case 'cloud': {
                                            const { service, table, id, query } = item as CloudDatabase;
                                            let queryString = table!;
                                            if (id) {
                                                queryString = 'id: ' + id;
                                            }
                                            else if (query) {
                                                queryString = typeof query !== 'string' ? JSON.stringify(query) : query;
                                            }
                                            this.formatFail(this.logType.CLOUD, service, ['Database query had no results', table ? 'table: ' + table : ''], new Error(service + ` -> ${queryString} (Empty)`));
                                            break;
                                        }
                                        case 'mongodb': {
                                            const { uri, name, table } = item as MongoDataSource;
                                            this.formatFail(this.logType.PROCESS, name || 'MONGO', ['MongoDB query had no results', table ? 'table: ' + table : ''], new Error(`mongodb -> ${uri!} (Empty)`));
                                            break;
                                        }
                                        case 'uri': {
                                            const { uri, format = path.extname(uri).substring(1) } = item as UriDataSource;
                                            this.formatFail(this.logType.PROCESS, format, ['URI data source had no results', uri], new Error(uri + ' (Empty)'));
                                            break;
                                        }
                                    }
                                }
                                removeElement();
                            }
                            resolve();
                        });
                    }), 'Element text or attribute replacement', this.errors);
                }
            }
            for (const item of elements) {
                if (isRemoved(item)) {
                    const element = item.element!;
                    const domElement = new HtmlElement(moduleName, element, item.attributes);
                    domElement.remove = true;
                    if (!domBase.write(domElement)) {
                        this.writeFail('Exclude tag removal', getErrorDOM(element.tagName, element.tagIndex));
                    }
                }
            }
            if (domBase.modified) {
                source = domBase.close();
            }
            source = transformCss.call(
                this,
                instance.assets,
                htmlFile,
                removeCss.call(instance, replaceContent(removeDatasetNamespace(moduleName, source, domBase.newline))),
                true
            );
            if (htmlFile.format) {
                const result = await instance.transform('html', source, htmlFile.format);
                if (result) {
                    source = result.code;
                }
            }
            htmlFile.sourceUTF8 = source;
            const failCount = domBase.failCount;
            if (failCount) {
                this.writeFail([`DOM update had ${failCount} ${failCount === 1 ? 'error' : 'errors'}`, moduleName], new Error(moduleName + ` -> DOM update (${failCount} failed)`));
            }
            else {
                this.writeTimeProcess('HTML', path.basename(localUri) + `: ${domBase.modifyCount} modified`, time);
            }
            if (domBase.hasErrors()) {
                this.errors.push(...domBase.errors.map(item => item.message));
            }
        }
        for (const file of inlineMap) {
            this.removeAsset(file);
        }
    }

    static async cleanup(this: IFileManager, instance: IChromeDocument) {
        const productionRelease = instance.productionRelease;
        if (Document.isString(productionRelease)) {
            if (path.isAbsolute(productionRelease) && fs.pathExistsSync(productionRelease)) {
                try {
                    const src = path.join(this.baseDirectory, instance.internalServerRoot);
                    if (fs.pathExistsSync(src)) {
                        fs.moveSync(src, productionRelease, { overwrite: true });
                    }
                }
                catch (err) {
                    this.writeFail(['Unable to move files', productionRelease], err, this.logType.FILE);
                }
            }
            else {
                this.writeFail(['Path not found', instance.moduleName], new Error(instance.moduleName + ` -> Invalid path (${productionRelease})`));
            }
        }
    }

    static sanitizeAssets(assets: DocumentAsset[], exclusions: DocumentAsset[] = []) {
        for (const item of assets) {
            if (!exclusions.includes(item)) {
                const mimeType = item.mimeType;
                if (mimeType && mimeType[0] === '@') {
                    item.mimeType = mimeType.substring(1);
                }
                item.format = undefined;
                item.trailingContent = undefined;
            }
        }
    }

    moduleName = 'chrome';
    module!: DocumentModule;
    assets: DocumentAsset[] = [];
    htmlFile: Null<DocumentAsset> = null;
    cssFiles: DocumentAsset[] = [];
    baseDirectory = '';
    host?: IFileManager;
    baseUrl?: string;
    productionRelease?: boolean | string;
    normalizeHtmlOutput?: boolean;
    usedVariables?: string[];
    usedFontFace?: string[];
    usedKeyframes?: string[];
    unusedStyles?: string[];
    unusedMedia?: string[];
    unusedSupports?: string[];
    internalAssignUUID = '__assign__';
    internalServerRoot = '__serverroot__';

    private _cloudMap!: ObjectMap<DocumentAsset>;
    private _cloudCssMap!: ObjectMap<DocumentAsset>;
    private _cloudUploaded!: Set<string>;
    private _cloudEndpoint!: Null<RegExp>;

    init(assets: DocumentAsset[], body: RequestBody) {
        assets.sort((a, b) => {
            if (a.bundleId && a.bundleId === b.bundleId) {
                return b.bundleIndex! - a.bundleIndex!;
            }
            return 0;
        });
        for (const item of assets) {
            switch (item.mimeType) {
                case '@text/html':
                    if (!this.htmlFile) {
                        this.htmlFile = item;
                    }
                    else {
                        item.mimeType = 'text/html';
                    }
                    break;
                case '@text/css':
                    this.cssFiles.push(item);
                    break;
            }
            if (item.cloudStorage) {
                for (const data of item.cloudStorage) {
                    if (data.upload) {
                        this.setLocalUri(data.upload);
                    }
                    if (data.download) {
                        this.setLocalUri(data.download);
                    }
                }
            }
        }
        this.assets = assets;
        this.baseUrl = body.baseUrl;
        this.usedVariables = body.usedVariables;
        this.usedFontFace = body.usedFontFace;
        this.usedKeyframes = body.usedKeyframes;
        this.unusedStyles = body.unusedStyles;
        this.unusedMedia = body.unusedMedia;
        this.unusedSupports = body.unusedSupports;
        this.configData = body.templateMap;
        this.productionRelease = body.productionRelease;
        this.normalizeHtmlOutput = body.normalizeHtmlOutput;
        if (this.baseUrl) {
            try {
                const { origin, pathname } = new URL(this.baseUrl);
                this.baseDirectory = origin + pathname.substring(0, pathname.lastIndexOf('/') + 1);
            }
            catch {
            }
        }
    }
    setLocalUri(file: Partial<LocationUri>) {
        const { pathname, filename } = file;
        if (pathname?.includes(this.internalAssignUUID)) {
            const format = this.module.format_uuid?.pathname;
            file.pathname = pathname.replace(this.internalAssignUUID, format ? Document.generateUUID(format) : uuid.v4());
        }
        if (filename?.includes(this.internalAssignUUID)) {
            const format = this.module.format_uuid?.filename;
            file.filename = filename.replace(this.internalAssignUUID, format ? Document.generateUUID(format) : uuid.v4());
        }
    }
    removeServerRoot(value: string) {
        return value.replace(new RegExp('(\\.\\./)*' + Document.escapePattern(this.internalServerRoot), 'g'), '');
    }
    addCopy(data: FileData, saveAs: string) {
        if (data.command && this.host) {
            const match = REGEXP_SRCSETSIZE.exec(data.command);
            if (match) {
                return Document.renameExt(this.host.getLocalUri(data), match[1] + match[2].toLowerCase() + '.' + saveAs);
            }
        }
    }
    writeImage(data: OutputData<DocumentAsset>) {
        const { file, output } = data;
        if (output) {
            const match = file.element?.outerXml && REGEXP_SRCSETSIZE.exec(data.command);
            if (match) {
                (file.srcSet ||= []).push(Document.toPosix(data.baseDirectory ? output.substring(data.baseDirectory.length + 1) : output), match[1] + match[2].toLowerCase());
                return true;
            }
        }
        return false;
    }
    cloudInit(state: CloudScopeOrigin) {
        this._cloudMap = {};
        this._cloudCssMap = {};
        this._cloudUploaded = new Set();
        this._cloudEndpoint = null;
        if (this.htmlFile) {
            const endpoint = state.instance.getStorage('upload', this.htmlFile.cloudStorage)?.upload?.endpoint;
            if (endpoint) {
                this._cloudEndpoint = new RegExp(Document.escapePattern(Document.toPosix(endpoint)) + '/', 'g');
            }
        }
    }
    cloudObject(state: CloudScopeOrigin, file: DocumentAsset) {
        if (file.inlineCloud) {
            this._cloudMap[file.inlineCloud] = file;
        }
        if (file.inlineCssCloud) {
            this._cloudCssMap[file.inlineCssCloud] = file;
        }
        return this.htmlFile === file || this.cssFiles.includes(file);
    }
    async cloudUpload(state: CloudScopeOrigin, file: DocumentAsset, url: string, active: boolean) {
        if (active) {
            const host = state.host;
            const htmlFile = this.htmlFile;
            const { inlineCloud, inlineCssCloud } = file;
            let cloudUrl = this._cloudEndpoint ? url.replace(this._cloudEndpoint, '') : url;
            if (inlineCloud) {
                if (htmlFile) {
                    htmlFile.sourceUTF8 = host.getUTF8String(htmlFile).replace(new RegExp(Document.escapePattern(inlineCloud), 'g'), cloudUrl);
                }
                this._cloudUploaded.add(inlineCloud);
            }
            file.cloudUrl = cloudUrl;
            if (inlineCssCloud) {
                const pattern = new RegExp(Document.escapePattern(inlineCssCloud), 'g');
                if (htmlFile) {
                    htmlFile.sourceUTF8 = host.getUTF8String(htmlFile).replace(pattern, cloudUrl);
                }
                if (this._cloudEndpoint && cloudUrl.indexOf('/') !== -1) {
                    cloudUrl = url;
                }
                for (const item of this.cssFiles) {
                    if (item.inlineCssMap?.[inlineCssCloud]) {
                        item.sourceUTF8 = host.getUTF8String(item).replace(pattern, cloudUrl);
                    }
                }
                this._cloudUploaded.add(inlineCssCloud);
            }
        }
        return false;
    }
    async cloudFinalize(state: CloudScopeOrigin) {
        const { host, localStorage } = state;
        const htmlFile = this.htmlFile;
        const cloudMap = this._cloudMap;
        let tasks: Promise<unknown>[] = [];
        for (const item of this.cssFiles) {
            if (item.inlineCssMap) {
                let source = host.getUTF8String(item);
                for (const id in this._cloudCssMap) {
                    const inlineCss = item.inlineCssMap[id];
                    if (inlineCss && !this._cloudUploaded.has(id)) {
                        source = source.replace(new RegExp(Document.escapePattern(id), 'g'), inlineCss);
                        localStorage.delete(this._cloudCssMap[id]!);
                    }
                }
                tasks.push(fs.writeFile(item.localUri!, source, 'utf8').then(() => item.sourceUTF8 = source).catch(err => {
                    throw err;
                }));
            }
        }
        if (tasks.length) {
            await Document.allSettled(tasks, ['Update "text/css" <cloud storage>', this.moduleName], host.errors);
            tasks = [];
        }
        for (const item of this.cssFiles) {
            if (item.cloudStorage) {
                if (item.compress) {
                    await host.compressFile(item);
                }
                tasks.push(...Cloud.uploadAsset.call(host, state, item, 'text/css'));
            }
        }
        if (tasks.length) {
            await Document.allSettled(tasks, ['Upload "text/css" <cloud storage>', this.moduleName], host.errors);
        }
        if (htmlFile) {
            if (Object.keys(cloudMap).length) {
                let source = host.getUTF8String(htmlFile);
                for (const id in cloudMap) {
                    if (!this._cloudUploaded.has(id)) {
                        const file = cloudMap[id]!;
                        source = source.replace(new RegExp(Document.escapePattern(id), 'g'), file.relativeUri!);
                        localStorage.delete(file);
                    }
                }
                if (this._cloudEndpoint) {
                    source = source.replace(this._cloudEndpoint, '');
                }
                try {
                    fs.writeFileSync(htmlFile.localUri!, source, 'utf8');
                    htmlFile.sourceUTF8 = source;
                }
                catch (err) {
                    this.writeFail(['Unable to write file', path.basename(htmlFile.localUri!)], err, this.logType.FILE);
                }
            }
            if (htmlFile.cloudStorage) {
                if (htmlFile.compress) {
                    await host.compressFile(htmlFile);
                }
                await Document.allSettled(Cloud.uploadAsset.call(host, state, htmlFile, 'text/html', true), ['Upload "text/html" <cloud storage>', this.moduleName], host.errors);
            }
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChromeDocument;
    module.exports.default = ChromeDocument;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default ChromeDocument;