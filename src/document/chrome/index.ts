import type { ElementAction } from '../../types/lib/squared';

import type { IFileManager } from '../../types/lib';
import type { FileData, OutputData } from '../../types/lib/asset';
import type { SourceMapOutput } from '../../types/lib/document';
import type { DocumentModule } from '../../types/lib/module';
import type { RequestBody } from '../../types/lib/node';

import type { CloudScopeOrigin } from '../../cloud';
import type { DocumentAsset, IChromeDocument } from './document';

import type * as domhandler from 'domhandler';

import path = require('path');
import fs = require('fs-extra');
import escapeRegexp = require('escape-string-regexp');
import uuid = require('uuid');

import Document from '../../document';
import Cloud from '../../cloud';
import { DomWriter, HtmlElement } from '../parse';

const REGEXP_SRCSETSIZE = /~\s*([\d.]+)\s*([wx])/i;
const PATTERN_TRAILINGSPACE = '[ \\t]*((?:\\r?\\n)*)';

function removeDatasetNamespace(name: string, source: string) {
    if (source.includes('data-' + name)) {
        return source
            .replace(new RegExp(`(\\s*)<(script|link|style).+?data-${name}-file\\s*=\\s*(["'])?exclude\\3[\\S\\s]*?<\\/\\2\\>` + PATTERN_TRAILINGSPACE, 'gi'), (...capture) => HtmlElement.getNewlineString(capture[1], capture[4]))
            .replace(new RegExp(`(\\s*)<(?:script|link).+?data-${name}-file\\s*=\\s*(["'])?exclude\\2[^>]*>` + PATTERN_TRAILINGSPACE, 'gi'), (...capture) => HtmlElement.getNewlineString(capture[1], capture[3]))
            .replace(new RegExp(`(\\s*)<script.+?data-${name}-template\\s*=\\s*(?:"[^"]*"|'[^']*')[\\S\\s]*?<\\/script>` + PATTERN_TRAILINGSPACE, 'gi'), (...capture) => HtmlElement.getNewlineString(capture[1], capture[2]))
            .replace(new RegExp(`\\s+data-${name}-[a-z-]+\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'g'), '');
    }
    return source;
}

function getObjectValue(data: unknown, key: string, joinString = ' ') {
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
    if (found) {
        if (Array.isArray(value)) {
            return value.join(joinString);
        }
        else if (typeof value === 'object') {
            return JSON.stringify(value);
        }
        return (value as string).toString();
    }
    return '';
}

function replaceBase64Url(source: string, base64: string, url: string, fromHTML?: boolean) {
    const pattern = new RegExp(`\\s*(["'])?([^"'=,]+?,\\s*${base64.replace(/\+/g, '\\+')}\\s*)\\1\\s*`, 'g');
    let output: Undef<string>,
        match: Null<RegExpExecArray>;
    while (match = pattern.exec(source)) {
        output = (output || source).replace(match[2], url);
        if (fromHTML) {
            break;
        }
    }
    return output;
}

function removeCss(source: string, styles: string[]) {
    const leading = ['^', '}'];
    let output: Undef<string>,
        pattern: Undef<RegExp>,
        match: Null<RegExpExecArray>;
    for (let value of styles) {
        const block = `(\\s*)${value = escapeRegexp(value)}\\s*\\{[^}]*\\}` + PATTERN_TRAILINGSPACE;
        for (let i = 0; i < 2; ++i) {
            pattern = new RegExp(leading[i] + block, i === 0 ? 'm' : 'g');
            while (match = pattern.exec(source)) {
                output = (output || source).replace(match[0], (i === 1 ? '}' : '') + HtmlElement.getNewlineString(match[1], match[2]));
                if (i === 0) {
                    break;
                }
            }
            if (output) {
                source = output;
            }
        }
        pattern = new RegExp(`(}?[^,{}]*?)((,?\\s*)${value}\\s*[,{](\\s*)).*?\\{?`, 'g');
        while (match = pattern.exec(source)) {
            const segment = match[2];
            let outerHTML = '';
            if (segment.trim().endsWith('{')) {
                outerHTML = ' {' + match[4];
            }
            else if (segment[0] === ',') {
                outerHTML = ', ';
            }
            else if (match[1] === '}' && match[3] && !match[3].trim()) {
                outerHTML = match[3];
            }
            output = (output || source).replace(match[0], match[0].replace(segment, outerHTML));
        }
        if (output) {
            source = output;
        }
    }
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
        url = url.replace(/^\s*["']?\s*/, '').replace(/\s*["']?\s*$/, '');
        const asset = this.findAsset(Document.resolvePath(url, cssUri)) as DocumentAsset;
        if (asset && !asset.invalid) {
            const setOutputUrl = (value: string) => {
                if (this.Cloud?.getStorage('upload', asset.cloudStorage)) {
                    if (!asset.inlineCssCloud) {
                        (cssFile.inlineCssMap ||= {})[asset.inlineCssCloud = uuid.v4()] = value;
                    }
                    value = asset.inlineCssCloud;
                }
                output = (output || content).replace(content.substring(match!.index, i + 1), 'url(' + quote + value + quote + ')');
            };
            if (url.startsWith('data:')) {
                const base64 = url.split(',')[1];
                for (const item of assets) {
                    if (item.base64 === base64) {
                        setOutputUrl(getRelativeUri.call(this, cssFile, asset));
                        break;
                    }
                }
            }
            else if (asset.format === 'base64') {
                setOutputUrl(asset.inlineBase64 ||= uuid.v4());
            }
            else if (!Document.isFileHTTP(url) || Document.hasSameOrigin(cssUri, url)) {
                setOutputUrl(getRelativeUri.call(this, cssFile, asset));
            }
            else {
                const pathname = cssFile.pathname;
                const count = pathname && pathname !== '/' ? pathname.split(/[\\/]/).length : 0;
                setOutputUrl((count ? '../'.repeat(count) : '') + asset.relativeUri);
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
const getErrorDOM = (tagName: string, tagIndex: number) => new Error(`${tagName.toUpperCase()} ${tagIndex}: Unable to parse DOM`);

class ChromeDocument extends Document implements IChromeDocument {
    public static async using(this: IFileManager, instance: ChromeDocument, file: DocumentAsset) {
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
                const assets = this.getDocumentAssets(instance) as DocumentAsset[];
                const items = assets.filter(item => item.base64 || item.format === 'base64');
                if (items.length) {
                    const domBase = new DomWriter(
                        instance.moduleName,
                        this.getUTF8String(file, localUri),
                        (assets as ElementAction[]).concat(this.getCloudAssets(instance)).filter(item => item.element).map(item => item.element!)
                    );
                    let modified: Undef<boolean>;
                    for (const item of items) {
                        const base64 = item.base64;
                        if (base64) {
                            const url = this.Cloud?.getStorage('upload', item.cloudStorage) ? item.inlineCloud ||= uuid.v4() : item.relativeUri!;
                            const findAll = (elem: domhandler.Element) => {
                                if (elem.tagName === 'style') {
                                    return !!elem.children.find((child: domhandler.DataNode) => child.type === 'text' && child.nodeValue.includes(base64));
                                }
                                else if (elem.attribs.style?.includes(base64)) {
                                    return true;
                                }
                                return false;
                            };
                            if (domBase.replaceAll(findAll, (elem: domhandler.Element, value: string) => replaceBase64Url(value.substring(elem.startIndex!, elem.endIndex! + 1), base64, url, true))) {
                                modified = true;
                            }
                            else {
                                delete item.inlineCloud;
                            }
                        }
                        else {
                            const element = item.element!;
                            const domElement = new HtmlElement(instance.moduleName, element, item.attributes);
                            setElementAttribute.call(instance, file, item, domElement, item.inlineBase64 ||= uuid.v4());
                            if (domBase.write(domElement)) {
                                item.watch = false;
                                modified = true;
                            }
                            else {
                                const { tagName, tagIndex } = element;
                                this.writeFail(['Element base64 attribute replacement', tagName], getErrorDOM(tagName, tagIndex));
                                delete item.inlineBase64;
                            }
                        }
                    }
                    if (modified) {
                        file.sourceUTF8 = domBase.source;
                    }
                }
                break;
            }
            case '@text/css': {
                const trailing = concatString(file.trailingContent);
                const bundle = this.getAssetContent(file);
                let source = await instance.formatContent(this, file, this.getUTF8String(file, localUri));
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

    public static async finalize(this: IFileManager, instance: IChromeDocument, assets: DocumentAsset[]) {
        const moduleName = instance.moduleName;
        const inlineMap = new Set<DocumentAsset>();
        const base64Map: StringMap = {};
        const tasks: Promise<unknown>[] = [];
        const replaceContent = (source: string) => {
            for (const id in base64Map) {
                source = source.replace(new RegExp(escapeRegexp(id), 'g'), base64Map[id]!);
            }
            if (instance.productionRelease) {
                source = source.replace(new RegExp('(\\.\\./)*' + escapeRegexp(instance.internalServerRoot), 'g'), '');
            }
            return source;
        };
        const setBase64Url = (item: DocumentAsset, data: Buffer) => {
            base64Map[item.inlineBase64!] = `data:${item.mimeType!};base64,${data.toString('base64').trim()}`;
            this.removeAsset(item);
        };
        for (const item of assets) {
            if (item.inlineBase64) {
                if (item.buffer) {
                    setBase64Url(item, item.buffer);
                }
                else {
                    tasks.push(fs.readFile(item.localUri!).then((data: Buffer) => setBase64Url(item, data)));
                }
            }
        }
        if (tasks.length) {
            await Document.allSettled(tasks, ['Unable to read base64 buffer', instance.moduleName], this.errors);
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
        for (const html of instance.htmlFiles) {
            const { format, localUri } = html;
            this.formatMessage(this.logType.PROCESS, 'HTML', ['Rewriting content...', path.basename(localUri!)]);
            const time = Date.now();
            const cloud = this.Cloud;
            const database = this.getCloudAssets(instance);
            const domBase = new DomWriter(
                moduleName,
                this.getUTF8String(html, localUri),
                (assets as ElementAction[]).concat(database).filter(item => item.element).map(item => item.element!)
            );
            if (database.length) {
                const cacheKey = uuid.v4();
                const pattern = /\$\{\s*(\w+)\s*\}/g;
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
                    if (result.length) {
                        const { element, value: template } = database[index];
                        const domElement = new HtmlElement(moduleName, element!);
                        if (typeof template === 'string') {
                            if (HtmlElement.hasInnerHTML(element!.tagName)) {
                                let output = '',
                                    match: Null<RegExpExecArray>;
                                for (const row of result) {
                                    let value = template;
                                    while (match = pattern.exec(template)) {
                                        value = value.replace(match[0], getObjectValue(row, match[1]));
                                    }
                                    output += value;
                                    pattern.lastIndex = 0;
                                }
                                domElement.innerHTML = output;
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
                                        value += (value ? joinString : '') + getObjectValue(row, col, joinString);
                                    }
                                    if (value) {
                                        domElement.setAttribute(attr, value);
                                        break;
                                    }
                                }
                            }
                        }
                        if (!domBase.write(domElement)) {
                            const { tagName, tagIndex } = element!;
                            this.writeFail(['Cloud text replacement', tagName], getErrorDOM(tagName, tagIndex));
                        }
                    }
                    else {
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
            for (const item of assets.filter(asset => asset.element && !(asset.invalid && !asset.exclude && asset.bundleIndex === undefined)).sort((a, b) => isRemoved(a) ? -1 : isRemoved(b) ? 1 : 0)) {
                const { element, bundleIndex, inlineContent, attributes } = item;
                const { tagName, tagIndex } = element!;
                const domElement = new HtmlElement(moduleName, element!, attributes);
                if (inlineContent) {
                    domElement.tagName = inlineContent;
                    domElement.innerHTML = this.getUTF8String(item).trim();
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
                    domElement.innerHTML = '';
                    if (!domBase.write(domElement, { rename: tagName === 'style' })) {
                        this.writeFail(['Bundle tag replacement', tagName], getErrorDOM(tagName, tagIndex));
                        delete item.inlineCloud;
                    }
                }
                else if (isRemoved(item) && !domBase.write(domElement, { remove: true })) {
                    this.writeFail(['Exclude tag removal', tagName], getErrorDOM(tagName, tagIndex));
                }
            }
            for (const item of assets) {
                const element = item.element;
                if (item.invalid || !element || !item.attributes && (item === html || !item.uri && !item.srcSet) || item.content || item.inlineContent || item.format === 'base64' || item.base64 || item.bundleIndex !== undefined) {
                    continue;
                }
                const { uri, attributes, srcSet } = item;
                const domElement = new HtmlElement(moduleName, element, attributes);
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
                        let src = domElement.getAttribute('srcset') || '',
                            i = 0;
                        while (i < length) {
                            src += (src ? ', ' : '') + srcSet[i++] + ' ' + srcSet[i++];
                        }
                        domElement.setAttribute('srcset', src);
                    }
                }
                if (!domBase.write(domElement)) {
                    const { tagName, tagIndex } = element;
                    this.writeFail(['Element attribute replacement', tagName], getErrorDOM(tagName, tagIndex));
                    delete item.inlineCloud;
                }
            }
            let source = replaceContent(removeDatasetNamespace(instance.moduleName, domBase.close()));
            source = transformCss.call(this, assets, html, source, true) || source;
            if (format) {
                const result = await instance.transform('html', source, format);
                if (result) {
                    source = result.code;
                }
            }
            html.sourceUTF8 = source;
            const failCount = domBase.failCount;
            if (failCount) {
                this.writeFail([`DOM update had ${failCount} ${failCount === 1 ? 'error' : 'errors'}`, instance.moduleName], new Error(`${instance.moduleName}: ${failCount} modifications failed`));
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

    public assets: DocumentAsset[] = [];
    public htmlFiles: DocumentAsset[] = [];
    public cssFiles: DocumentAsset[] = [];
    public baseDirectory = '';
    public baseUrl = '';
    public internalServerRoot = '__serverroot__';
    public unusedStyles?: string[];
    public readonly moduleName = 'chrome';

    private _cloudMap!: ObjectMap<DocumentAsset>;
    private _cloudCssMap!: ObjectMap<DocumentAsset>;
    private _cloudUploaded!: Set<string>;
    private _cloudEndpoint!: Null<RegExp>;
    private _cloudHtml: Undef<DocumentAsset>;

    constructor(settings: DocumentModule, templateMap?: StandardMap, public productionRelease = false) {
        super(settings, templateMap);
    }

    public init(assets: DocumentAsset[], body: RequestBody) {
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
            switch (a.mimeType) {
                case '@text/html':
                case '@text/css':
                    return -1;
            }
            switch (b.mimeType) {
                case '@text/html':
                case '@text/css':
                    return 1;
            }
            return 0;
        });
        for (const item of assets) {
            switch (item.mimeType) {
                case '@text/html':
                    this.htmlFiles.push(item);
                    break;
                case '@text/css':
                    this.cssFiles.push(item);
                    break;
            }
        }
        this.assets = assets;
    }

    async formatContent(manager: IFileManager, file: DocumentAsset, content: string): Promise<string> {
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
    addCopy(manager: IFileManager, data: FileData, saveAs: string) {
        if (data.command) {
            const match = REGEXP_SRCSETSIZE.exec(data.command);
            if (match) {
                return Document.renameExt(manager.getLocalUri(data), match[1] + match[2].toLowerCase() + '.' + saveAs);
            }
        }
    }
    writeImage(manager: IFileManager, data: OutputData<DocumentAsset>) {
        const { file, output } = data;
        if (output) {
            const match = file.element?.outerHTML && REGEXP_SRCSETSIZE.exec(data.command);
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
        this._cloudHtml = this.htmlFiles[0];
        if (this._cloudHtml) {
            const endpoint = state.instance.getStorage('upload', this._cloudHtml.cloudStorage)?.upload?.endpoint;
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
        return this._cloudHtml === file || this.cssFiles.includes(file);
    }
    async cloudUpload(state: CloudScopeOrigin, file: DocumentAsset, url: string, active: boolean) {
        if (active) {
            const host = state.host;
            const html = this._cloudHtml;
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
        const html = this._cloudHtml;
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