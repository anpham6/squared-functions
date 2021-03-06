import type { LocationUri, XmlTagNode } from '../../types/lib/squared';
import type { DataSource, MongoDataSource, RequestData, TemplateMap, UriDataSource } from '../../types/lib/chrome';

import type { IFileManager } from '../../types/lib';
import type { FileProcessing, OutputFinalize } from '../../types/lib/asset';
import type { CloudDatabase } from '../../types/lib/cloud';
import type { HttpRequestOptions } from '../../types/lib/http';
import type { RequestBody as IRequestBody } from '../../types/lib/node';

import type { CloudScopeOrigin } from '../../cloud';
import type { DocumentAsset, DocumentModule, IChromeDocument } from './document';

import type * as toml from 'toml';
import type * as jsonpath from 'jsonpath';
import type * as jmespath from 'jmespath';

import { ERR_MESSAGE } from '../../types/lib/logger';
import { ERR_CLOUD } from '../../cloud';

import path = require('path');
import fs = require('fs-extra');
import yaml = require('js-yaml');
import uuid = require('uuid');

import mongodb = require('mongodb');

import Document from '../../document';
import Cloud from '../../cloud';
import { DomWriter, HtmlElement } from '../parse/dom';

interface RequestBody extends IRequestBody, RequestData {}

const MongoClient = mongodb.MongoClient;

const REGEXP_SRCSETSIZE = /~\s*([\d.]+)\s*([wx])/i;
const REGEXP_CSSVARIABLE = new RegExp(`(\\s*)(--[^\\s:]*)\\s*:[^;}]*([;}])` + DomWriter.PATTERN_TRAILINGSPACE, 'g');
const REGEXP_CSSFONT = new RegExp(`(\\s*)@font-face\\s*{([^}]+)}` + DomWriter.PATTERN_TRAILINGSPACE, 'gi');
const REGEXP_CSSKEYFRAME = /(\s*)@keyframes\s+([^{]+){/gi;
const REGEXP_CSSCLOSING = /\b(?:url\(\s*(?:"[^"]+"|'[^']+'|[^\s)]+)\s*\)|content\s*:\s*(?:"[^"]*"|'[^']*'))/gi;
const REGEXP_TEMPLATECONDITIONAL = /(\n\s+)?\{\{\s*if\s+(!)?\s*([^}\s]+)\s*\}\}(\s*)([\S\s]*?)(?:\s*\{\{\s*else\s*\}\}(\s*)([\S\s]*?)\s*)?\s*\{\{\s*end\s*\}\}/gi;
const REGEXP_OBJECTPROPERTY = /\$\{\s*([^\s}]+)\s*\}/g;
const REGEXP_OBJECTVALUE = /([^[.\s]+)((?:\s*\[[^\]]+\]\s*)+)?\s*\.?\s*/g;
const REGEXP_OBJECTINDEX = /\[\s*(["'])?(.+?)\1\s*\]/g;
const MONGO_SSLCACHE: ObjectMap<Buffer> = {};

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

function removeCss(document: IChromeDocument, source: string) {
    const { usedVariables, usedFontFace, usedKeyframes, unusedStyles, unusedMedia, unusedSupports } = document;
    if (!usedVariables && !usedFontFace && !usedKeyframes && !unusedStyles && !unusedMedia && !unusedSupports) {
        return source;
    }
    const replaceMap: StringMap = {};
    let current = source,
        modified: Undef<boolean>,
        checkEmpty: Undef<Set<string>>,
        match: Null<RegExpExecArray>;
    while (match = REGEXP_CSSCLOSING.exec(current)) {
        if (match[0].indexOf('}') !== -1) {
            const placeholder = uuid.v4();
            replaceMap[placeholder] = match[0];
            current = spliceSource(REGEXP_CSSCLOSING, current, match.index, getEndIndex(match), placeholder);
        }
    }
    REGEXP_CSSCLOSING.lastIndex = 0;
    const replaceUnunsed = (name: string, items: string[]) => {
        for (const value of items) {
            const pattern = new RegExp(`(\\s*)@${name}\\s+${Document.escapePattern(value.trim()).replace(/\s+/g, '\\s+')}\\s*{`, 'gi');
            while (match = pattern.exec(current)) {
                const [endIndex, trailing] = findClosingIndex(current, match.index + match[0].length);
                if (endIndex !== -1) {
                    current = spliceString(pattern, current, match.index, endIndex, match[1], trailing);
                    modified = true;
                    (checkEmpty ||= new Set()).add(name);
                }
            }
        }
    };
    const removeEmpty = (name: string) => {
        const pattern = new RegExp(`(\\s*)@${name}\\s*[^{]*{\\s*}` + DomWriter.PATTERN_TRAILINGSPACE, 'gi');
        while (match = pattern.exec(current)) {
            current = spliceString(pattern, current, match.index, getEndIndex(match), match[1], match[2]);
        }
    };
    if (unusedMedia) {
        replaceUnunsed('media', unusedMedia);
    }
    if (unusedSupports) {
        replaceUnunsed('supports', unusedSupports);
    }
    if (unusedStyles) {
        for (let value of unusedStyles) {
            const block = `(\\s*)${value = Document.escapePattern(value).replace(/\s+/g, '\\s+')}\\s*\\{[^}]*\\}` + DomWriter.PATTERN_TRAILINGSPACE;
            for (let i = 0; i < 2; ++i) {
                const pattern = new RegExp(`(${i === 0 ? '^' : '[{}]'})` + block, i === 0 ? 'm' : 'g');
                while (match = pattern.exec(current)) {
                    current = spliceString(pattern, current, match.index, getEndIndex(match), match[2], match[3], i === 0 ? '' : match[1]);
                    modified = true;
                    if (i === 0) {
                        break;
                    }
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
                current = spliceSource(pattern, current, match.index, getEndIndex(match), match[0].replace(segment, outerXml));
                modified = true;
            }
        }
    }
    if (usedVariables) {
        while (match = REGEXP_CSSVARIABLE.exec(current)) {
            if (!usedVariables.includes(match[2])) {
                current = spliceSource(REGEXP_CSSVARIABLE, current, match.index, getEndIndex(match), match[3] === ';' ? DomWriter.getNewlineString(match[1], match[4]) : '');
                modified = true;
            }
        }
        REGEXP_CSSVARIABLE.lastIndex = 0;
    }
    if (usedFontFace) {
        const fonts = usedFontFace.map(value => value.toLowerCase());
        while (match = REGEXP_CSSFONT.exec(current)) {
            const font = /font-family\s*:([^;}]+)/i.exec(match[0]);
            if (font && !fonts.includes(font[1].trim().replace(/^(["'])(.+)\1$/, (...content) => content[2]).toLowerCase())) {
                current = spliceString(REGEXP_CSSFONT, current, match.index, getEndIndex(match), match[1], match[3]);
                modified = true;
            }
        }
        REGEXP_CSSFONT.lastIndex = 0;
    }
    if (usedKeyframes) {
        while (match = REGEXP_CSSKEYFRAME.exec(current)) {
            if (!usedKeyframes.includes(match[2].trim())) {
                const [endIndex, trailing] = findClosingIndex(current, match.index + match[0].length);
                if (endIndex !== -1) {
                    current = spliceString(REGEXP_CSSKEYFRAME, current, match.index, endIndex, match[1], trailing);
                    modified = true;
                }
            }
        }
        REGEXP_CSSKEYFRAME.lastIndex = 0;
    }
    if (modified) {
        if (checkEmpty) {
            checkEmpty.forEach(name => removeEmpty(name));
        }
        for (const attr in replaceMap) {
            current = current.replace(attr, replaceMap[attr]!);
        }
        return current;
    }
    return source;
}

function getRelativeUri(cssFile: DocumentAsset, asset: DocumentAsset) {
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

function transformCss(manager: IFileManager, assets: DocumentAsset[], cssFile: DocumentAsset, source: string, fromHTML?: boolean, mainFile?: DocumentAsset) {
    const cloud = manager.Cloud;
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
            if (cloud && cloud.getStorage('upload', asset.cloudStorage)) {
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
                    setOutputUrl(item, getRelativeUri(cssFile, item));
                    break;
                }
            }
        }
        else {
            let fullUrl = Document.resolvePath(url, cssUri);
            const asset = manager.findAsset(fullUrl) as Undef<DocumentAsset>;
            if (asset && !asset.invalid) {
                if (asset.format === 'base64') {
                    fullUrl = asset.inlineBase64 ||= uuid.v4();
                }
                else if (!Document.isFileHTTP(fullUrl) || Document.hasSameOrigin(cssUri, fullUrl)) {
                    fullUrl = getRelativeUri(mainFile || cssFile, asset);
                }
                else {
                    const pathname = cssFile.pathname;
                    const count = pathname && pathname !== '/' ? pathname.split(/[\\/]/).length : 0;
                    fullUrl = (count ? '../'.repeat(count) : '') + asset.relativeUri;
                }
                if (url !== fullUrl) {
                    setOutputUrl(asset, fullUrl);
                }
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

function setElementAttribute(document: IChromeDocument, htmlFile: DocumentAsset, asset: DocumentAsset, element: HtmlElement, value: string) {
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
                const src = new Set([uri]);
                const sameOrigin = Document.hasSameOrigin(baseUri, uri);
                if (sameOrigin) {
                    let url = element.getAttribute('src');
                    if (url && uri === Document.resolvePath(url = Document.toPosix(url), baseUri)) {
                        src.add(url);
                    }
                    src.add(uri.startsWith(document.baseDirectory) ? uri.substring(document.baseDirectory.length) : uri.replace(new URL(baseUri).origin, ''));
                }
                let current = srcset,
                    match: Null<RegExpExecArray>;
                for (const url of src) {
                    const resolve = sameOrigin && !Document.isFileHTTP(url);
                    const pathname = escapePosix(url);
                    const pattern = new RegExp(`(,?\\s*)(${(resolve && url[0] !== '.' ? `(?:\\.\\.[\\\\/])*\\.\\.${pathname}|` : '') + pathname})([^,]*)`, 'g');
                    while (match = pattern.exec(current)) {
                        if (!resolve || uri === Document.resolvePath(match[2], baseUri)) {
                            current = spliceSource(pattern, current, match.index, getEndIndex(match), match[1] + value + match[3]);
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

function spliceString(pattern: RegExp, source: string, startIndex: number, endIndex: number, leading = '', trailing = '', content = '') {
    if (leading || trailing) {
        content += DomWriter.getNewlineString(leading, trailing);
    }
    if (content) {
        pattern.lastIndex = startIndex + content.length;
    }
    return source.substring(0, startIndex) + content + source.substring(endIndex + 1);
}

function spliceSource(pattern: RegExp, source: string, startIndex: number, endIndex: number, content: string) {
    pattern.lastIndex = startIndex + content.length;
    return source.substring(0, startIndex) + content + source.substring(endIndex + 1);
}

function isTruthy(data: PlainObject, attr: string, falsey: Undef<string | boolean>) {
    const value = !!getObjectValue(data, attr);
    return falsey ? !value : value;
}

function getFormatUUID(settings: DocumentModule, attr: "pathname" | "filename") {
    const format_uuid = settings.format_uuid;
    return format_uuid && format_uuid[attr] ? Document.generateUUID(format_uuid[attr], format_uuid.dictionary) : uuid.v4();
}

const getEndIndex = (match: RegExpExecArray) => match.index + match[0].length - 1;
const isRemoved = (item: DocumentAsset) => item.exclude === true || item.bundleIndex !== undefined && item.bundleIndex > 0;
const concatString = (values: Undef<string[]>): string => values ? values.reduce((a, b) => a + '\n' + b, '') : '';
const escapePosix = (value: string) => value.split(/[\\/]/).map(seg => Document.escapePattern(seg)).join('[\\\\/]');
const getErrorDOM = (tagName: string, tagIndex: Undef<number>) => new Error(tagName.toLowerCase() + (tagIndex !== undefined && tagIndex >= 0 ? ': ' + tagIndex : '') + ' (Unable to parse DOM)');

class ChromeDocument extends Document implements IChromeDocument {
    static async using(this: IFileManager, instance: ChromeDocument, file: DocumentAsset) {
        const { localUri, format, mimeType } = file;
        switch (mimeType) {
            case 'text/html':
                if (format) {
                    const result = await instance.transform('html', this.getUTF8String(file, localUri), format, { mimeType });
                    if (result) {
                        file.sourceUTF8 = result.code;
                    }
                }
                break;
            case 'text/css':
                if (format) {
                    const result = await instance.transform('css', this.getUTF8String(file, localUri), format, { mimeType });
                    if (result) {
                        if (result.map) {
                            const uri = Document.writeSourceMap(localUri!, result, { emptySources: !!instance.productionRelease });
                            if (uri) {
                                this.add(uri, file);
                            }
                        }
                        file.sourceUTF8 = result.code;
                    }
                }
                break;
            case 'text/javascript':
            case 'application/javascript': {
                const trailing = concatString(file.trailingContent);
                const bundle = this.getAssetContent(file);
                if (!bundle && !trailing && !format) {
                    break;
                }
                const leading = this.getUTF8String(file, localUri) + trailing;
                let source = leading;
                if (bundle) {
                    source += bundle;
                }
                if (format) {
                    const type = file.attributes?.type;
                    const result = await instance.transform('js', source, format, { mimeType: type || mimeType, chunks: !!file.element, getSourceFiles: Document.createSourceFilesMethod.bind(this)(instance, file, leading) });
                    if (result) {
                        if (result.map) {
                            const mapUri = Document.writeSourceMap(localUri!, result, { emptySources: !!instance.productionRelease });
                            if (mapUri) {
                                this.add(mapUri, file);
                            }
                        }
                        source = result.code;
                        const chunks = result.chunks;
                        if (chunks) {
                            const xmlNodes = instance.xmlNodes;
                            const localDir = path.dirname(localUri!);
                            const relativeDir = path.dirname(file.relativeUri!);
                            const element = file.element!;
                            const appending: XmlTagNode[] = [];
                            for (const item of xmlNodes) {
                                if (item.append && !item.append.prepend && (item.index === element.index && DomWriter.isIndex(element.index) || item.tagName === element.tagName && item.tagIndex === element.tagIndex && DomWriter.isIndex(element.tagIndex))) {
                                    appending.push(item);
                                }
                            }
                            let order = 0;
                            for (const chunk of chunks) {
                                const filename = chunk.filename || (getFormatUUID(instance.module, 'filename') + path.extname(localUri!));
                                const chunkUri = path.join(localDir, filename);
                                if (chunk.map) {
                                    const mapUri = Document.writeSourceMap(chunkUri, chunk, { emptySources: !!instance.productionRelease });
                                    if (mapUri) {
                                        this.add(mapUri, file);
                                    }
                                }
                                try {
                                    fs.writeFileSync(chunkUri, chunk.code, 'utf8');
                                    this.add(chunkUri, file);
                                    if (chunk.entryPoint) {
                                        xmlNodes.push({
                                            ...element,
                                            append: { tagName: 'script', tagCount: element.tagCount, order: ++order },
                                            attributes: {
                                                ...file.attributes,
                                                type: type || (mimeType === 'application/javascript' ? 'module' : mimeType),
                                                src: Document.joinPath(relativeDir, filename)
                                            }
                                        } as XmlTagNode);
                                    }
                                }
                                catch (err) {
                                    instance.writeFail([ERR_MESSAGE.WRITE_FILE, chunkUri], err, instance.logType.FILE);
                                }
                            }
                            appending.forEach(item => item.append!.order += order);
                        }
                        if (result.sourceFiles) {
                            file.sourceFiles = result.sourceFiles;
                        }
                    }
                }
                file.sourceUTF8 = source;
                break;
            }
            case '@text/html': {
                const items = instance.assets.filter(item => item.format === 'base64' && item.element);
                if (items.length) {
                    const domBase = new DomWriter(instance.moduleName, this.getUTF8String(file, localUri), instance.xmlNodes, instance.normalizeHtmlOutput);
                    for (const item of items) {
                        const element = item.element!;
                        const domElement = new HtmlElement(instance.moduleName, element, item.attributes);
                        setElementAttribute(instance, file, item, domElement, item.inlineBase64 ||= uuid.v4());
                        if (domBase.write(domElement)) {
                            item.watch = false;
                        }
                        else {
                            instance.writeFail('Element attribute replacement', getErrorDOM(element.tagName, element.tagIndex));
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
                const source = this.getAssetContent(file, this.getUTF8String(file, localUri) + concatString(file.trailingContent))!;
                file.sourceUTF8 = transformCss(this, instance.assets, file, !file.preserve ? removeCss(instance, source) : source);
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
                    instance.writeFail([ERR_MESSAGE.READ_FILE, item.localUri!], err, this.logType.FILE);
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
                const result = await instance.transform('css', source, css.format, { mimeType: 'text/css' });
                if (result) {
                    if (result.map) {
                        const uri = Document.writeSourceMap(css.localUri!, result, { emptySources: !!instance.productionRelease });
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
            const domBase = new DomWriter(moduleName, source, instance.xmlNodes, instance.normalizeHtmlOutput);
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
                    const [innerXml, sourceMappingURL] = Document.removeSourceMappingURL(this.getUTF8String(item).trim());
                    if (sourceMappingURL && item.localUri) {
                        try {
                            let mapUri = path.resolve(sourceMappingURL);
                            if (!fs.existsSync(mapUri)) {
                                mapUri = path.join(path.dirname(item.localUri), sourceMappingURL);
                            }
                            if (fs.existsSync(mapUri)) {
                                fs.unlinkSync(mapUri);
                                this.delete(mapUri);
                            }
                        }
                        catch (err) {
                            if (!Document.isErrorCode(err, 'ENOENT')) {
                                instance.writeFail([ERR_MESSAGE.DELETE_FILE, sourceMappingURL], err, this.logType.FILE);
                            }
                        }
                    }
                    domElement.tagName = inlineContent;
                    domElement.innerXml = innerXml;
                    domElement.removeAttribute('src', 'href');
                }
                else if (uri && !crossorigin && item !== htmlFile) {
                    if (cloud && cloud.getStorage('upload', item.cloudStorage)) {
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
                    setElementAttribute(instance, htmlFile, item, domElement, uri);
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
                    instance.writeFail(inlineContent ? 'Inline tag replacement' : 'Element attribute replacement', getErrorDOM(element.tagName, element.tagIndex));
                    delete item.inlineCloud;
                }
                else if (inlineContent) {
                    inlineMap.add(item);
                    item.watch = false;
                }
            }
            const dataSource = instance.dataSource as DataSource[];
            if (dataSource.length) {
                const cacheKey = uuid.v4();
                const cacheData: ObjectMap<Optional<PlainObject[] | string>> = {};
                const dataItems: DataSource[] = [];
                const displayItems: DataSource[] = [];
                dataSource.forEach(item => item.type === 'display' ? displayItems.push(item) : dataItems.push(item));
                for (const db of [dataItems, displayItems]) {
                    await Document.allSettled(db.map(item => {
                        return new Promise<void>(async (resolve, reject) => {
                            const { element, limit, index } = item;
                            const domElement = new HtmlElement(moduleName, element!);
                            const removeElement = () => {
                                if (item.removeEmpty) {
                                    domElement.remove = true;
                                    if (!domBase.write(domElement)) {
                                        instance.writeFail('Unable to remove element', getErrorDOM(element!.tagName, element!.tagIndex));
                                    }
                                }
                            };
                            let result: PlainObject[] = [],
                                outError: unknown;
                            switch (item.source) {
                                case 'cloud':
                                    if (cloud) {
                                        result = await cloud.getDatabaseRows(item as CloudDatabase, cacheKey).catch(err => {
                                            if (err instanceof Error && err.message) {
                                                cloud.errors.push((item as CloudDatabase).service + ': ' + err.message);
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
                                                if (credential && credential.server) {
                                                    const { authMechanism = '', authMechanismProperties, user, dnsSrv } = credential;
                                                    let authSource = credential.authSource;
                                                    uri = `mongodb${dnsSrv ? '+srv' : ''}://` + (user ? encodeURIComponent(user) + (authMechanism !== 'GSSAPI' && credential.pwd ? ':' + encodeURIComponent(credential.pwd) : '') + '@' : '') + credential.server + '/?authMechanism=' + encodeURIComponent(authMechanism);
                                                    switch (authMechanism) {
                                                        case 'MONGODB-X509': {
                                                            let { sslKey, sslCert, sslValidate } = credential; // eslint-disable-line prefer-const
                                                            if (sslKey && sslCert && fs.existsSync(sslKey = path.resolve(sslKey)) && fs.existsSync(sslCert = path.resolve(sslCert))) {
                                                                options.sslKey = MONGO_SSLCACHE[sslKey] ||= fs.readFileSync(sslKey);
                                                                options.sslCert = MONGO_SSLCACHE[sslCert] ||= fs.readFileSync(sslCert);
                                                                if (typeof sslValidate === 'boolean') {
                                                                    options.sslValidate = sslValidate;
                                                                }
                                                                uri += '&ssl=true';
                                                            }
                                                            else {
                                                                reject(new Error('mongodb: Missing SSL credentials'));
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
                                                    reject(new Error('mongodb: Invalid credentials'));
                                                    return;
                                                }
                                                if (!('useUnifiedTopology' in options)) {
                                                    options.useUnifiedTopology = true;
                                                }
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
                                                instance.writeFail([ERR_CLOUD.QUERY_DB, name + ':' + table], err);
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
                                        reject(new Error('mongodb: Missing URI connection string'));
                                        return;
                                    }
                                    break;
                                }
                                case 'uri': {
                                    const { uri, query, encoding = 'utf8', format = path.extname(uri).substring(1) } = item as UriDataSource;
                                    let content: Optional<string>;
                                    if (Document.isFileHTTP(uri)) {
                                        if (uri in cacheData) {
                                            content = cacheData[uri] as Undef<string>;
                                        }
                                        else {
                                            const options: HttpRequestOptions = { encoding };
                                            try {
                                                const buffer = await this.fetchBuffer(uri, options);
                                                content = Buffer.isBuffer(buffer) ? buffer.toString(encoding) : buffer;
                                            }
                                            catch (err) {
                                                outError = err;
                                            }
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
                                                    content = fs.readFileSync(pathname, encoding);
                                                    cacheData[pathname] = content;
                                                }
                                                else {
                                                    removeElement();
                                                    reject(new Error(`data-source: No read permission (${uri})`));
                                                    return;
                                                }
                                            }
                                            catch (err) {
                                                instance.writeFail([ERR_MESSAGE.READ_FILE, pathname], err, this.logType.FILE);
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
                                                    data = (require('toml') as typeof toml).parse(content);
                                                    break;
                                                default:
                                                    removeElement();
                                                    reject(new Error(`data-source: Format invalid (${format})`));
                                                    return;
                                            }
                                        }
                                        catch (err) {
                                            instance.writeFail(['Unable to load data source', format], err);
                                            removeElement();
                                            resolve();
                                            return;
                                        }
                                        if (data && query) {
                                            const lib = query[0] === '$' ? 'jsonpath' : 'jmespath';
                                            try {
                                                if (lib === 'jsonpath') {
                                                    data = (require(lib) as typeof jsonpath).query(data, query, limit);
                                                }
                                                else {
                                                    data = (require(lib) as typeof jmespath).search(data, query);
                                                }
                                            }
                                            catch (err) {
                                                instance.writeFail([ERR_MESSAGE.INSTALL, 'npm i ' + lib], err);
                                            }
                                        }
                                        if (Array.isArray(data)) {
                                            result = data;
                                        }
                                        else if (Document.isObject(data)) {
                                            result = [data];
                                        }
                                        else {
                                            removeElement();
                                            reject(new Error(`data-source: URI invalid (${uri})`));
                                            return;
                                        }
                                    }
                                    else {
                                        removeElement();
                                        if (content !== null) {
                                            reject(new Error(`data-source: Empty response (${uri})`));
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
                                    reject(new Error(`data-source: Invalid (${item.source as string || ERR_MESSAGE.UNKNOWN})`));
                                    return;
                            }
                            if (index !== undefined) {
                                const data = result[index] as Undef<PlainObject>;
                                result = data ? [data] : [];
                            }
                            else if (limit !== undefined && result.length > limit) {
                                result.length = limit;
                            }
                            const { postQuery, preRender } = item;
                            if (postQuery) {
                                const value = instance.findDataMethodString(postQuery);
                                const method = Document.asFunction<PlainObject[]>(value || postQuery);
                                if (method) {
                                    try {
                                        const output = await method(result, item);
                                        if (Array.isArray(output)) {
                                            result = output;
                                        }
                                    }
                                    catch (err) {
                                        instance.writeFail(['Invalid external method', value ? postQuery : ''], err);
                                    }
                                }
                            }
                            if (result.length) {
                                let template = item.value || element!.textContent || domElement.innerXml,
                                    value = '',
                                    errors: Undef<boolean>;
                                const checkPreRender = async (name: string) => {
                                    const dataString = instance.findDataMethodString(name);
                                    const method = Document.asFunction(dataString || name);
                                    if (method) {
                                        try {
                                            const output = await method(value, item);
                                            if (typeof output === 'string') {
                                                value = output;
                                            }
                                        }
                                        catch (err) {
                                            instance.writeFail(['Invalid external method', dataString ? preRender : ''], err);
                                        }
                                    }
                                };
                                switch (item.type) {
                                    case 'text':
                                        if (typeof template === 'string' && !domElement.tagVoid) {
                                            if (item.viewEngine) {
                                                const content = await instance.parseTemplate(item.viewEngine, template, result);
                                                if (content !== null) {
                                                    value = content;
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
                                                    value += segment;
                                                    REGEXP_OBJECTPROPERTY.lastIndex = 0;
                                                    REGEXP_TEMPLATECONDITIONAL.lastIndex = 0;
                                                }
                                            }
                                            if (preRender) {
                                                await checkPreRender(preRender);
                                            }
                                            domElement.innerXml = value;
                                        }
                                        else {
                                            errors = true;
                                        }
                                        break;
                                    case 'attribute':
                                        if (Document.isObject(template)) {
                                            for (const attr in template) {
                                                let segment = template[attr],
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
                                                    if (preRender) {
                                                        await checkPreRender(preRender);
                                                    }
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
                                                            const sign = seg[0];
                                                            let keep = true;
                                                            switch (sign) {
                                                                case '-':
                                                                case '+':
                                                                    seg = seg.substring(1);
                                                                    break;
                                                            }
                                                            const data = getObjectValue(row, seg);
                                                            if (data === undefined || data === null) {
                                                                if (sign !== '+') {
                                                                    keep = false;
                                                                }
                                                            }
                                                            else {
                                                                switch (sign) {
                                                                    case '-':
                                                                        if (!data) {
                                                                            keep = false;
                                                                        }
                                                                        break;
                                                                    case '+':
                                                                        if (data) {
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
                                        reject(new Error(`data-source: Invalid action (${item.type as string || ERR_MESSAGE.UNKNOWN})`));
                                        return;
                                }
                                if (!domBase.write(domElement) || errors) {
                                    instance.writeFail(item.type === 'display' ? errors && domElement.remove ? 'Element was removed with errors' : 'Unable to remove element' : 'Unable to replace ' + item.type, getErrorDOM(element!.tagName, element!.tagIndex));
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
                                            (cloud || instance).formatFail(this.logType.CLOUD, service, [ERR_CLOUD.QUERY_DB, table ? 'table: ' + table : ''], outError || new Error(service + `: ${queryString} (Empty)`));
                                            break;
                                        }
                                        case 'mongodb': {
                                            const { uri, name, table } = item as MongoDataSource;
                                            instance.formatFail(this.logType.PROCESS, name || 'MONGO', [ERR_CLOUD.QUERY_DB, table ? 'table: ' + table : ''], outError || new Error(`mongodb: ${uri!} (Empty)`));
                                            break;
                                        }
                                        case 'uri': {
                                            const { uri, format = path.extname(uri).substring(1) } = item as UriDataSource;
                                            instance.formatFail(this.logType.PROCESS, format, ['URI data source was empty', uri], outError || new Error(uri + ' (Empty)'));
                                            break;
                                        }
                                    }
                                }
                                removeElement();
                            }
                            resolve();
                        });
                    }), { rejected: 'Element text or attribute replacement', errors: instance.errors });
                }
            }
            for (const item of elements) {
                if (isRemoved(item)) {
                    const element = item.element!;
                    const domElement = new HtmlElement(moduleName, element, item.attributes);
                    domElement.remove = true;
                    if (!domBase.write(domElement)) {
                        instance.writeFail('Exclude tag removal', getErrorDOM(element.tagName, element.tagIndex));
                    }
                }
            }
            if (domBase.modified) {
                source = domBase.close();
            }
            source = replaceContent(
                transformCss(
                    this,
                    instance.assets,
                    htmlFile,
                    removeCss(instance, removeDatasetNamespace(moduleName, source, domBase.newline)),
                    true
                )
            );
            if (htmlFile.format) {
                const result = await instance.transform('html', source, htmlFile.format, { mimeType: 'text/html' });
                if (result) {
                    source = result.code;
                }
            }
            htmlFile.sourceUTF8 = source;
            const failCount = domBase.failCount;
            this.writeTimeProcess('HTML', path.basename(localUri) + `: ${domBase.modifyCount} modified`, time, { failed: failCount > 0 });
            if (failCount) {
                instance.writeFail([`DOM update had ${failCount} ${failCount === 1 ? 'error' : 'errors'}`, moduleName], new Error(`DOM update (${failCount} failed)`));
            }
            if (domBase.hasErrors()) {
                const errors = instance.errors;
                domBase.errors.forEach(item => errors.push('dom-parser: ' + item.message));
            }
        }
        inlineMap.forEach(file => this.removeAsset(file));
        return super.finalize.call(this, instance);
    }

    static async cleanup(this: IFileManager, instance: IChromeDocument) {
        const productionRelease = instance.productionRelease;
        if (Document.isString(productionRelease)) {
            try {
                if (path.isAbsolute(productionRelease) && fs.existsSync(productionRelease)) {
                    const src = path.join(this.baseDirectory, instance.internalServerRoot);
                    if (fs.existsSync(src)) {
                        fs.moveSync(src, productionRelease, { overwrite: true });
                    }
                }
                else {
                    instance.writeFail([ERR_MESSAGE.READ_DIRECTORY, instance.moduleName], new Error(`Invalid path (${productionRelease})`));
                }
            }
            catch (err) {
                instance.writeFail([ERR_MESSAGE.MOVE_FILE, productionRelease], err, this.logType.FILE);
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
    assets!: DocumentAsset[];
    htmlFile: Null<DocumentAsset> = null;
    cssFiles: DocumentAsset[] = [];
    baseDirectory = '';
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
        super.init(assets, body);
    }
    setLocalUri(file: Partial<LocationUri>) {
        const { pathname, filename } = file;
        if (pathname && pathname.includes(this.internalAssignUUID)) {
            file.pathname = pathname.replace(this.internalAssignUUID, getFormatUUID(this.module, 'pathname'));
        }
        if (filename && filename.includes(this.internalAssignUUID)) {
            file.filename = filename.replace(this.internalAssignUUID, getFormatUUID(this.module, 'filename'));
        }
    }
    resolveUri(file: DocumentAsset, source: string) {
        if (file.mimeType === '@text/css' && this.host) {
            for (const asset of this.assets) {
                if (asset.bundleId === file.bundleId && asset.bundleIndex === 0) {
                    return transformCss(this.host, this.assets, file, source, false, asset);
                }
            }
        }
        return source;
    }
    removeServerRoot(value: string) {
        return value.replace(new RegExp('(\\.\\./)*' + Document.escapePattern(this.internalServerRoot), 'g'), '');
    }
    findDataMethodString(name: string) {
        if (this.configData && this.module.eval_template) {
            return (this.configData as TemplateMap).data?.[name];
        }
    }
    addCopy(data: FileProcessing, saveAs: string) {
        if (data.command && this.host) {
            const match = REGEXP_SRCSETSIZE.exec(data.command);
            if (match) {
                return Document.renameExt(this.host.getLocalUri(data), match[1] + match[2].toLowerCase() + '.' + saveAs);
            }
        }
    }
    writeImage(data: OutputFinalize<DocumentAsset>) {
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
                try {
                    fs.writeFileSync(item.localUri!, source, item.encoding ||= 'utf8');
                    item.sourceUTF8 = source;
                }
                catch (err) {
                    this.writeFail(['Cloud update "text/css"', item.localUri!], err, this.logType.FILE);
                }
            }
        }
        const tasks: Promise<unknown>[] = [];
        for (const item of this.cssFiles) {
            if (item.cloudStorage) {
                if (item.compress) {
                    await host.compressFile(item);
                }
                tasks.push(...Cloud.uploadAsset.call(host, state, item, 'text/css'));
            }
        }
        if (tasks.length) {
            await Document.allSettled(tasks, { rejected: ['Cloud upload "text/css"', this.moduleName], errors: host.errors });
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
                    fs.writeFileSync(htmlFile.localUri!, source, htmlFile.encoding ||= 'utf8');
                    htmlFile.sourceUTF8 = source;
                }
                catch (err) {
                    this.writeFail([ERR_MESSAGE.WRITE_FILE, htmlFile.localUri!], err, this.logType.FILE);
                }
            }
            if (htmlFile.cloudStorage) {
                if (htmlFile.compress) {
                    await host.compressFile(htmlFile);
                }
                await Document.allSettled(Cloud.uploadAsset.call(host, state, htmlFile, 'text/html', true), { rejected: ['Upload "text/html" <cloud storage>', this.moduleName], errors: host.errors });
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