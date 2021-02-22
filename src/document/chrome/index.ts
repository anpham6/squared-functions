import type { LocationUri } from '../../types/lib/squared';

import type { IFileManager } from '../../types/lib';
import type { FileData, OutputData } from '../../types/lib/asset';
import type { SourceMapOutput } from '../../types/lib/document';
import type { DocumentModule } from '../../types/lib/module';
import type { RequestBody } from '../../types/lib/node';

import type { CloudScopeOrigin } from '../../cloud';
import type { DocumentAsset, IChromeDocument } from './document';

import path = require('path');
import fs = require('fs-extra');
import escapeRegexp = require('escape-string-regexp');
import uuid = require('uuid');

import Document from '../../document';
import Cloud from '../../cloud';
import { DomWriter, HtmlElement } from '../parse/dom';

const REGEXP_SRCSETSIZE = /~\s*([\d.]+)\s*([wx])/i;
const REGEXP_CSSCONTENT = /\s*(?:content\s*:\s*(?:"[^"]*"|'[^']*')|url\(\s*(?:"[^"]+"|'[^']+'|[^)]+)\s*\))/ig;
const REGEXP_OBJECTPROPERTY = /\$\{\s*(\w+)\s*\}/g;
const REGEXP_TEMPLATECONDITIONAL = /(\n\s+)?\{\{\s*if\s+(!)?\s*([^}\s]+)\s*\}\}(\s*)([\S\s]*?)(?:\s*\{\{\s*else\s*\}\}(\s*)([\S\s]*?)\s*)?\s*\{\{\s*end\s*\}\}/g;

function removeDatasetNamespace(name: string, source: string) {
    if (source.includes('data-' + name)) {
        return source
            .replace(new RegExp(`(\\s*)<(script|style)${DomWriter.PATTERN_TAGOPEN}+?data-${name}-file\\s*=\\s*(["'])?exclude\\3${DomWriter.PATTERN_TAGOPEN}*>[\\S\\s]*?<\\/\\2>` + DomWriter.PATTERN_TRAILINGSPACE, 'gi'), (...capture) => DomWriter.getNewlineString(capture[1], capture[4]))
            .replace(new RegExp(`(\\s*)<link${DomWriter.PATTERN_TAGOPEN}+?data-${name}-file\\s*=\\s*(["'])?exclude\\2${DomWriter.PATTERN_TAGOPEN}*>` + DomWriter.PATTERN_TRAILINGSPACE, 'gi'), (...capture) => DomWriter.getNewlineString(capture[1], capture[3]))
            .replace(new RegExp(`(\\s*)<script${DomWriter.PATTERN_TAGOPEN}+?data-${name}-template\\s*${DomWriter.PATTERN_ATTRVALUE + DomWriter.PATTERN_TAGOPEN}*>[\\S\\s]*?<\\/script>` + DomWriter.PATTERN_TRAILINGSPACE, 'gi'), (...capture) => DomWriter.getNewlineString(capture[1], capture[2]))
            .replace(new RegExp(`\\s+data-${name}-[a-z-]+\\s*` + DomWriter.PATTERN_ATTRVALUE, 'g'), '');
    }
    return source;
}

function getObjectValue(data: unknown, key: string) {
    const pattern = /([^[.\s]+)((?:\s*\[[^\]]+\]\s*)+)?\s*\.?\s*/g;
    const indexPattern = /\[\s*(["'])?(.+?)\1\s*\]/g;
    let found = false,
        value = data,
        index: Null<RegExpMatchArray>,
        match: Null<RegExpMatchArray>;
    while (match = pattern.exec(key)) {
        if (isObject(value)) {
            value = value[match[1]];
            if (match[2]) {
                indexPattern.lastIndex = 0;
                while (index = indexPattern.exec(match[2])) {
                    const attr = index[1] ? index[2] : index[2].trim();
                    if (index[1] && isObject(value) || /^\d+$/.test(attr) && (typeof value === 'string' || Array.isArray(value))) {
                        value = value[attr];
                    }
                    else {
                        return '';
                    }
                }
            }
            if (value !== undefined && value !== null) {
                found = true;
                continue;
            }
        }
        return '';
    }
    return found ? value : '';
}

function valueAsString(value: unknown, joinString = ' ') {
    switch (typeof value) {
        case 'string':
        case 'number':
        case 'boolean':
            return value.toString();
        default:
            return Array.isArray(value) ? value.join(joinString) : JSON.stringify(value);
    }
}

function removeCss(source: string, styles: string[]) {
    const replaceMap: StringMap = {};
    let current = source,
        output: Undef<string>,
        pattern: Undef<RegExp>,
        match: Null<RegExpExecArray>;
    while (match = REGEXP_CSSCONTENT.exec(source)) {
        if (match[0].includes('}')) {
            const placeholder = uuid.v4();
            replaceMap[placeholder] = match[0];
            current = current.replace(match[0], placeholder);
        }
    }
    for (let value of styles) {
        const block = `(\\s*)${value = escapeRegexp(value)}\\s*\\{[^}]*\\}` + DomWriter.PATTERN_TRAILINGSPACE;
        for (let i = 0; i < 2; ++i) {
            pattern = new RegExp((i === 0 ? '^' : '}') + block, i === 0 ? 'm' : 'g');
            while (match = pattern.exec(current)) {
                output = (output || current).replace(match[0], (i === 0 ? '' : '}') + DomWriter.getNewlineString(match[1], match[2]));
                if (i === 0) {
                    break;
                }
            }
            if (output) {
                current = output;
            }
        }
        pattern = new RegExp(`(}?[^,{}]*?)((,?\\s*)${value}\\s*[,{](\\s*)).*?\\{?`, 'g');
        while (match = pattern.exec(current)) {
            const segment = match[2];
            let outerXml = '';
            if (segment.trim().endsWith('{')) {
                outerXml = ' {' + match[4];
            }
            else if (segment[0] === ',') {
                outerXml = ', ';
            }
            else if (match[1] === '}' && match[3] && !match[3].trim()) {
                outerXml = match[3];
            }
            output = (output || current).replace(match[0], match[0].replace(segment, outerXml));
        }
        if (output) {
            current = output;
        }
    }
    if (output) {
        for (const attr in replaceMap) {
            output = output.replace(attr, replaceMap[attr]!);
        }
    }
    REGEXP_CSSCONTENT.lastIndex = 0;
    return output;
}

function getRelativeUri(this: IFileManager, cssFile: DocumentAsset, asset: DocumentAsset) {
    if (cssFile.inlineContent) {
        return asset.relativeUri!;
    }
    const splitPath = (value: string) => value.split(/[\\/]/).filter(segment => segment.trim());
    let fileDir = cssFile.pathname,
        assetDir = asset.pathname;
    if (fileDir === assetDir && (cssFile.moveTo || '') === (asset.moveTo || '')) {
        return asset.filename;
    }
    if (cssFile.moveTo) {
        if (cssFile.moveTo === asset.moveTo) {
            assetDir = Document.joinPosix(asset.moveTo, asset.pathname);
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
                this.writeFail(['Unable to copy file', path.basename(moveUri)], err);
            }
        }
        fileDir = Document.joinPosix(cssFile.moveTo, cssFile.pathname);
    }
    const prefix = splitPath(fileDir);
    const suffix = splitPath(assetDir);
    let found: Undef<boolean>;
    while (prefix.length && suffix.length && prefix[0] === suffix[0]) {
        prefix.shift();
        suffix.shift();
        found = true;
    }
    return found ? Document.joinPosix('../'.repeat(prefix.length), suffix.join('/'), asset.filename) : '../'.repeat(prefix.length) + asset.relativeUri!;
}

function transformCss(this: IFileManager, assets: DocumentAsset[], cssFile: DocumentAsset, content: string, fromHTML?: boolean) {
    const cssUri = cssFile.uri!;
    const length = content.length;
    const pattern = /url\(/gi;
    let output: Undef<string>,
        match: Null<RegExpExecArray>;
    while (match = pattern.exec(content)) {
        let url = '',
            quote = '',
            i = match.index + match[0].length,
            j = -1;
        for ( ; i < length; ++i) {
            const ch = content[i];
            if (!quote) {
                switch (ch) {
                    case '"':
                    case "'":
                        if (!url.trim()) {
                            quote = ch;
                            continue;
                        }
                        break;
                }
            }
            if (ch === ')') {
                if (content[i - 1] !== '\\') {
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
            if (this.Cloud?.getStorage('upload', asset.cloudStorage)) {
                if (fromHTML) {
                    value = asset.inlineCloud ||= uuid.v4();
                }
                else {
                    const inlineCssCloud = asset.inlineCssCloud ||= uuid.v4();
                    (cssFile.inlineCssMap ||= {})[inlineCssCloud] ||= value;
                    value = inlineCssCloud;
                }
            }
            output = (output || content).replace(content.substring(match!.index, i + 1), 'url(' + quote + value + quote + ')');
        };
        url = url.replace(/^\s*["']?\s*/, '').replace(/\s*["']?\s*$/, '');
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
            const asset = this.findAsset(Document.resolvePath(url, cssUri)) as DocumentAsset;
            if (asset && !asset.invalid) {
                if (asset.format === 'base64') {
                    setOutputUrl(asset, asset.inlineBase64 ||= uuid.v4());
                }
                else if (!Document.isFileHTTP(url) || Document.hasSameOrigin(cssUri, url)) {
                    setOutputUrl(asset, getRelativeUri.call(this, cssFile, asset));
                }
                else {
                    const pathname = cssFile.pathname;
                    const count = pathname && pathname !== '/' ? pathname.split(/[\\/]/).length : 0;
                    setOutputUrl(asset, (count ? '../'.repeat(count) : '') + asset.relativeUri);
                }
            }
        }
    }
    return output;
}

function setElementAttribute(this: ChromeDocument, htmlFile: DocumentAsset, asset: DocumentAsset, element: HtmlElement, value: string) {
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
                const uri = asset.uri!;
                const src = [uri];
                const sameOrigin = Document.hasSameOrigin(baseUri, uri);
                if (sameOrigin) {
                    let url = element.getAttribute('src');
                    if (url && uri === Document.resolvePath(url, baseUri)) {
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

const concatString = (values: Undef<string[]>) => values ? values.reduce((a, b) => a + '\n' + b, '') : '';
const escapePosix = (value: string) => value.split(/[\\/]/).map(seg => escapeRegexp(seg)).join('[\\\\/]');
const isObject = (value: unknown): value is PlainObject => typeof value === 'object' && value !== null;
const isRemoved = (item: DocumentAsset) => item.exclude || item.bundleIndex !== undefined;
const getErrorDOM = (tagName: string, tagIndex: Undef<number>) => new Error(tagName.toUpperCase() + (tagIndex !== undefined && tagIndex >= 0 ? ' ' + tagIndex : '') + ': Unable to parse DOM');

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
                const bundle = this.getAssetContent(file);
                const trailing = concatString(file.trailingContent);
                if (!bundle && !trailing && !format) {
                    break;
                }
                let source = this.getUTF8String(file, localUri);
                if (trailing) {
                    source += trailing;
                }
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
                    const domBase = new DomWriter(instance.moduleName, this.getUTF8String(file, localUri), this.getElements());
                    for (const item of items) {
                        const domElement = new HtmlElement(instance.moduleName, item.element!, item.attributes);
                        setElementAttribute.call(instance, file, item, domElement, item.inlineBase64 ||= uuid.v4());
                        if (domBase.write(domElement)) {
                            item.watch = false;
                        }
                        else {
                            const { tagName, tagIndex } = item.element!;
                            this.writeFail(['Element base64 attribute replacement', tagName], getErrorDOM(tagName, tagIndex));
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
                const trailing = concatString(file.trailingContent);
                const bundle = this.getAssetContent(file);
                let source = await instance.formatContent(file, this.getUTF8String(file, localUri), this);
                if (trailing) {
                    source += trailing;
                }
                if (bundle) {
                    source += bundle;
                }
                file.sourceUTF8 = source;
                break;
            }
        }
    }

    static async finalize(this: IFileManager, instance: IChromeDocument) {
        const moduleName = instance.moduleName;
        const html = instance.htmlFile;
        const inlineMap = new Set<DocumentAsset>();
        const base64Map: StringMap = {};
        const elements: DocumentAsset[] = [];
        const replaceContent = (source: string) => {
            for (const id in base64Map) {
                source = source.replace(new RegExp(escapeRegexp(id), 'g'), base64Map[id]!);
            }
            if (instance.productionRelease) {
                source = source.replace(new RegExp('(\\.\\./)*' + escapeRegexp(instance.internalServerRoot), 'g'), '');
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
                    this.writeFail(['Unable to read base64 buffer', moduleName], err);
                }
            }
            if (item.element) {
                elements.push(item);
            }
        }
        for (const css of instance.cssFiles) {
            const { format, localUri } = css;
            let source = replaceContent(this.getUTF8String(css, localUri));
            if (format) {
                const result = await instance.transform('css', source, format);
                if (result) {
                    if (result.map) {
                        const uri = Document.writeSourceMap(localUri!, result as SourceMapOutput);
                        if (uri) {
                            this.add(uri, css);
                        }
                    }
                    source = result.code;
                }
            }
            css.sourceUTF8 = source;
        }
        if (html) {
            const { format, localUri } = html;
            this.formatMessage(this.logType.PROCESS, 'HTML', ['Rewriting content...', path.basename(localUri!)]);
            const time = Date.now();
            const cloud = this.Cloud;
            let source = this.getUTF8String(html, localUri);
            const domBase = new DomWriter(moduleName, source, this.getElements());
            const database = this.getCloudAssets(instance).filter(item => item.element);
            if (database.length) {
                const cacheKey = uuid.v4();
                (await Promise.all(
                    database.map(item => {
                        return cloud!.getDatabaseRows(item, cacheKey).catch(err => {
                            if (err instanceof Error && err.message) {
                                this.errors.push(err.message);
                            }
                            return [];
                        });
                    })
                )).forEach((result, index) => {
                    const item = database[index];
                    const element = item.element!;
                    const domElement = new HtmlElement(moduleName, element);
                    const template = item.value || element.textContent || domElement.innerXml;
                    let tagOffset: Undef<ObjectMap<Undef<number>>>;
                    if (result.length) {
                        if (typeof template === 'string') {
                            if (!domElement.tagVoid) {
                                let innerXml = '';
                                if (item.viewEngine) {
                                    const { name, options = {} } = item.viewEngine;
                                    try {
                                        const render = require(name).compile(template, options.compile) as FunctionType<string>;
                                        for (let i = 0; i < result.length; ++i) {
                                            const row = result[i];
                                            row['__index__'] = i + 1;
                                            innerXml += render(options.output ? { ...options.output, ...row } : row);
                                        }
                                    }
                                    catch (err) {
                                        ++domBase.failCount;
                                        this.writeFail(['Cloud view engine incompatible', name], err);
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
                                            let value = new Boolean(getObjectValue(row, match[3]));
                                            if (match[2]) {
                                                value = !value;
                                            }
                                            const index = value ? 5 : 7;
                                            segment = segment.replace(match[0], match[index] ? (match[index - 1].includes('\n') ? '' : match[1]) + match[index - 1] + match[index] : '');
                                        }
                                        innerXml += segment;
                                        REGEXP_OBJECTPROPERTY.lastIndex = 0;
                                        REGEXP_TEMPLATECONDITIONAL.lastIndex = 0;
                                    }
                                }
                                tagOffset = DomWriter.getTagCount(domElement.innerXml, innerXml);
                                domElement.innerXml = innerXml;
                            }
                        }
                        else {
                            for (const attr in template) {
                                let columns = template[attr]!;
                                if (typeof columns === 'string') {
                                    columns = [columns];
                                }
                                for (const row of result) {
                                    let value = '',
                                        joinString = ' ';
                                    for (const col of columns) {
                                        if (col[0] === ':') {
                                            const join = /^:join\((.*)\)$/.exec(col);
                                            if (join) {
                                                joinString = join[1];
                                            }
                                            continue;
                                        }
                                        value += (value ? joinString : '') + valueAsString(getObjectValue(row, col), joinString);
                                    }
                                    if (value) {
                                        domElement.setAttribute(attr, value);
                                        break;
                                    }
                                }
                            }
                        }
                        if (!domBase.write(domElement, { tagOffset })) {
                            const { tagName, tagIndex } = element;
                            this.writeFail(['Cloud text replacement', tagName], getErrorDOM(tagName, tagIndex));
                        }
                    }
                    else {
                        if (item.removeEmpty && !domBase.write(domElement, { remove: true })) {
                            const { tagName, tagIndex } = element;
                            this.writeFail(['Cloud text removal when empty', tagName], getErrorDOM(tagName, tagIndex));
                        }
                        const { service, table, id, query } = database[index];
                        let queryString = '';
                        if (id) {
                            queryString = 'id: ' + id;
                        }
                        else if (query) {
                            queryString = typeof query !== 'string' ? JSON.stringify(query) : query;
                        }
                        this.formatFail(this.logType.CLOUD_DATABASE, service, ['Query had no results', table ? 'table: ' + table : ''], new Error(queryString));
                    }
                });
            }
            for (const item of elements.filter(asset => !(asset.invalid && !asset.exclude && asset.bundleIndex === undefined && !asset.element!.removed)).sort((a, b) => isRemoved(a) ? -1 : isRemoved(b) ? 1 : 0)) {
                const { element, bundleIndex, inlineContent, attributes } = item;
                const { tagName, tagIndex } = element!;
                const domElement = new HtmlElement(moduleName, element!, attributes);
                if (inlineContent) {
                    domElement.tagName = inlineContent;
                    domElement.innerXml = this.getUTF8String(item).trim();
                    domElement.removeAttribute('src', 'href');
                    if (domBase.write(domElement, { rename: tagName === 'link' })) {
                        inlineMap.add(item);
                        item.watch = false;
                    }
                    else {
                        this.writeFail(['Inline tag replacement', tagName], getErrorDOM(tagName, tagIndex));
                    }
                }
                else if (bundleIndex === 0 || bundleIndex === -1) {
                    let value: string;
                    if (cloud?.getStorage('upload', item.cloudStorage)) {
                        value = uuid.v4();
                        item.inlineCloud = value;
                    }
                    else {
                        value = item.relativeUri!;
                    }
                    switch (tagName) {
                        case 'link':
                        case 'style':
                            domElement.tagName = 'link';
                            domElement.setAttribute('rel', 'stylesheet');
                            domElement.setAttribute('href', value);
                            break;
                        default:
                            domElement.setAttribute('src', value);
                            break;
                    }
                    domElement.innerXml = '';
                    if (!domBase.write(domElement, { rename: tagName === 'style' })) {
                        this.writeFail(['Bundle tag replacement', tagName], getErrorDOM(tagName, tagIndex));
                        delete item.inlineCloud;
                    }
                }
                else if (isRemoved(item) && !domBase.write(domElement, { remove: true })) {
                    this.writeFail(['Exclude tag removal', tagName], getErrorDOM(tagName, tagIndex));
                }
            }
            for (const item of elements) {
                if (item.invalid || item.element!.removed || !item.attributes && (item === html || !item.uri && !item.srcSet) || item.content || item.inlineContent || item.format === 'base64' || item.bundleIndex !== undefined || isRemoved(item)) {
                    continue;
                }
                const { element, attributes, uri, srcSet } = item;
                const domElement = new HtmlElement(moduleName, element!, attributes);
                if (uri && item !== html) {
                    let value: string;
                    if (cloud?.getStorage('upload', item.cloudStorage)) {
                        value = uuid.v4();
                        item.inlineCloud = value;
                    }
                    else {
                        value = item.relativeUri!;
                    }
                    setElementAttribute.call(instance, html, item, domElement, value);
                    if (srcSet) {
                        const length = srcSet.length;
                        let src = domElement.getAttribute('srcset') || '',
                            i = 0;
                        while (i < length) {
                            src += (src ? ', ' : '') + srcSet[i++] + ' ' + srcSet[i++];
                        }
                        domElement.setAttribute('srcset', src);
                    }
                }
                if (!domBase.write(domElement)) {
                    const { tagName, tagIndex } = element!;
                    this.writeFail(['Element attribute replacement', tagName], getErrorDOM(tagName, tagIndex));
                    delete item.inlineCloud;
                }
            }
            if (domBase.modified) {
                source = domBase.close();
            }
            source = replaceContent(removeDatasetNamespace(moduleName, source));
            source = transformCss.call(this, instance.assets, html, source, true) || source;
            if (format) {
                const result = await instance.transform('html', source, format);
                if (result) {
                    source = result.code;
                }
            }
            html.sourceUTF8 = source;
            const failCount = domBase.failCount;
            if (failCount) {
                this.writeFail([`DOM update had ${failCount} ${failCount === 1 ? 'error' : 'errors'}`, moduleName], new Error(`${moduleName}: ${failCount} modifications failed`));
            }
            else {
                this.writeTimeElapsed('HTML', `${path.basename(localUri!)}: ${domBase.modifyCount} modified`, time);
            }
            if (domBase.hasErrors()) {
                this.errors.push(...domBase.errors.map(item => item.message));
            }
        }
        for (const file of inlineMap) {
            this.removeAsset(file);
        }
    }

    assets: DocumentAsset[] = [];
    htmlFile: Null<DocumentAsset> = null;
    cssFiles: DocumentAsset[] = [];
    baseDirectory = '';
    baseUrl = '';
    unusedStyles?: string[];
    moduleName = 'chrome';
    internalAssignUUID = '__assign__';
    internalServerRoot = '__serverroot__';

    private _cloudMap!: ObjectMap<DocumentAsset>;
    private _cloudCssMap!: ObjectMap<DocumentAsset>;
    private _cloudUploaded!: Set<string>;
    private _cloudEndpoint!: Null<RegExp>;

    constructor(
        settings: DocumentModule,
        templateMap?: StandardMap,
        public readonly productionRelease = false)
    {
        super(settings, templateMap);
    }

    init(assets: DocumentAsset[], body: RequestBody) {
        const { baseUrl, unusedStyles } = body;
        if (baseUrl) {
            try {
                const { origin, pathname } = new URL(baseUrl);
                this.baseDirectory = origin + pathname.substring(0, pathname.lastIndexOf('/') + 1);
                this.baseUrl = baseUrl;
            }
            catch {
            }
        }
        this.unusedStyles = unusedStyles;
        assets.sort((a, b) => {
            if (a.bundleId && a.bundleId === b.bundleId) {
                return a.bundleIndex! - b.bundleIndex!;
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
    }
    setLocalUri(file: Partial<LocationUri>) {
        const { pathname, filename } = file;
        if (pathname?.includes(this.internalAssignUUID)) {
            file.pathname = pathname.replace(this.internalAssignUUID, uuid.v4());
        }
        if (filename?.includes(this.internalAssignUUID)) {
            file.filename = filename.replace(this.internalAssignUUID, uuid.v4());
        }
    }
    async formatContent(file: DocumentAsset, content: string, manager: IFileManager): Promise<string> {
        if (file.mimeType === '@text/css') {
            if (!file.preserve && this.unusedStyles) {
                const result = removeCss(content, this.unusedStyles);
                if (result) {
                    content = result;
                }
            }
            const result = transformCss.call(manager, manager.getDocumentAssets(this), file, content);
            if (result) {
                content = result;
            }
        }
        return content;
    }
    addCopy(data: FileData, saveAs: string, replace = false, manager: IFileManager) {
        if (data.command) {
            const match = REGEXP_SRCSETSIZE.exec(data.command);
            if (match) {
                return Document.renameExt(manager.getLocalUri(data), match[1] + match[2].toLowerCase() + '.' + saveAs);
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
                this._cloudEndpoint = new RegExp(escapeRegexp(Document.toPosix(endpoint)) + '/', 'g');
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
            const html = this.htmlFile;
            const { inlineCloud, inlineCssCloud } = file;
            let cloudUrl = this._cloudEndpoint ? url.replace(this._cloudEndpoint, '') : url;
            if (inlineCloud) {
                if (html) {
                    html.sourceUTF8 = host.getUTF8String(html).replace(new RegExp(escapeRegexp(inlineCloud), 'g'), cloudUrl);
                }
                this._cloudUploaded.add(inlineCloud);
            }
            if (inlineCssCloud) {
                const pattern = new RegExp(escapeRegexp(inlineCssCloud), 'g');
                if (html) {
                    html.sourceUTF8 = host.getUTF8String(html).replace(pattern, cloudUrl);
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
            file.cloudUrl = cloudUrl;
        }
        return false;
    }
    async cloudFinalize(state: CloudScopeOrigin) {
        const { host, localStorage } = state;
        const html = this.htmlFile;
        const cloudMap = this._cloudMap;
        let tasks: Promise<unknown>[] = [];
        for (const item of this.cssFiles) {
            if (item.inlineCssMap) {
                let source = host.getUTF8String(item);
                for (const id in this._cloudCssMap) {
                    const inlineCss = item.inlineCssMap[id];
                    if (inlineCss && !this._cloudUploaded.has(id)) {
                        source = source.replace(new RegExp(escapeRegexp(id), 'g'), inlineCss);
                        localStorage.delete(this._cloudCssMap[id]);
                    }
                }
                tasks.push(fs.writeFile(item.localUri!, source, 'utf8'));
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
        if (html) {
            if (Object.keys(cloudMap).length) {
                let source = host.getUTF8String(html);
                for (const id in cloudMap) {
                    if (!this._cloudUploaded.has(id)) {
                        const file = cloudMap[id];
                        source = source.replace(new RegExp(escapeRegexp(id), 'g'), file.relativeUri!);
                        localStorage.delete(file);
                    }
                }
                if (this._cloudEndpoint) {
                    source = source.replace(this._cloudEndpoint, '');
                }
                try {
                    fs.writeFileSync(html.localUri!, source, 'utf8');
                }
                catch (err) {
                    this.writeFail(['Update "text/html" <cloud storage>', this.moduleName], err);
                }
            }
            if (html.cloudStorage) {
                if (html.compress) {
                    await host.compressFile(html);
                }
                await Document.allSettled(Cloud.uploadAsset.call(host, state, html, 'text/html', true), ['Upload "text/html" <cloud storage>', this.moduleName], host.errors);
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