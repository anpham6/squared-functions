import type { ElementAction } from '../../types/lib/squared';

import type { IFileManager } from '../../types/lib';
import type { FileData, OutputData } from '../../types/lib/asset';
import type { SourceMapOutput } from '../../types/lib/document';
import type { DocumentModule } from '../../types/lib/module';
import type { RequestBody } from '../../types/lib/node';

import type { CloudIScopeOrigin } from '../../cloud';
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

function removeDatasetNamespace(name: string, source: string) {
    if (source.includes('data-' + name)) {
        return source
            .replace(new RegExp(`(\\s*)<(script|link|style).+?data-${name}-file\\s*=\\s*(["'])?exclude\\3[\\S\\s]*?<\\/\\2\\>[ \\t]*((?:\\r?\\n)*)`, 'ig'), (...capture) => DomWriter.getNewlineString(capture[1], capture[4]))
            .replace(new RegExp(`(\\s*)<(?:script|link).+?data-${name}-file\\s*=\\s*(["'])?exclude\\2[^>]*>[ \\t]*((?:\\r?\\n)*)`, 'ig'), (...capture) => DomWriter.getNewlineString(capture[1], capture[3]))
            .replace(new RegExp(`(\\s*)<script.+?data-${name}-template\\s*=\\s*(?:"[^"]*"|'[^']*')[\\S\\s]*?<\\/script>[ \\t]*((?:\\r?\\n)*)`, 'ig'), (...capture) => DomWriter.getNewlineString(capture[1], capture[2]))
            .replace(new RegExp(`\\s+data-${name}-[a-z-]+\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'g'), '');
    }
    return source;
}

function getObjectValue(data: unknown, key: string, joinString = ' ') {
    const pattern = /([^[.\s]+)((?:\s*\[[^\]]+\]\s*)+)?\s*\.?\s*/g;
    const indexPattern = /\[\s*(["'])?(.+?)\1\s*\]/g;
    let found = false,
        value = data,
        match: Null<RegExpMatchArray>;
    while (match = pattern.exec(key)) {
        if (isObject(value)) {
            value = value[match[1]];
            if (match[2]) {
                let index: Null<RegExpMatchArray>;
                while (index = indexPattern.exec(match[2])) {
                    const attr = index[1] ? index[2] : index[2].trim();
                    if (index[1] && isObject(value) || /^\d+$/.test(attr) && (typeof value === 'string' || Array.isArray(value))) {
                        value = value[attr];
                    }
                    else {
                        return '';
                    }
                }
                indexPattern.lastIndex = 0;
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

function replaceUrl(css: string, src: string, value: string, base64: boolean) {
    const pattern = new RegExp(`\\s*[Uu][Rr][Ll]\\(\\s*(["'])?\\s*${!base64 ? escapePosix(src) : `[^"',]+,\\s*` + src.replace(/\+/g, '\\+')}\\s*\\1\\s*\\)`, 'g');
    let output: Undef<string>,
        match: Null<RegExpExecArray>;
    while (match = pattern.exec(css)) {
        output = (output || css).replace(match[0], 'url(' + match[1] + value + match[1] + ')');
    }
    return output;
}

function removeCss(source: string, styles: string[]) {
    const leading = ['^', '}'];
    let output: Undef<string>,
        pattern: Undef<RegExp>,
        match: Null<RegExpExecArray>;
    for (let value of styles) {
        value = escapeRegexp(value);
        const block = `(\\s*)${value}\\s*\\{[^}]*\\}[ \\t]*((?:\\r?\\n)*)`;
        for (let i = 0; i < 2; ++i) {
            pattern = new RegExp(leading[i] + block, i === 0 ? 'm' : 'g');
            while (match = pattern.exec(source)) {
                output = (output || source).replace(match[0], (i === 1 ? '}' : '') + DomWriter.getNewlineString(match[1], match[2]));
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
            let replaceHTML = '';
            if (segment.trim().endsWith('{')) {
                replaceHTML = ' {' + match[4];
            }
            else if (segment[0] === ',') {
                replaceHTML = ', ';
            }
            else if (match[1] === '}' && match[3] && !match[3].trim()) {
                replaceHTML = match[3];
            }
            output = (output || source).replace(match[0], match[0].replace(segment, replaceHTML));
        }
        if (output) {
            source = output;
        }
    }
    return output;
}

function findRelativeUri(this: IFileManager, file: DocumentAsset, url: string): [string, Null<DocumentAsset>] {
    const origin = file.uri!;
    const asset = this.findAsset(Document.resolvePath(url, origin)) as DocumentAsset;
    if (asset) {
        if (file.inlineContent) {
            return [asset.relativeUri!, asset];
        }
        const splitPath = (value: string) => value.split(/[\\/]/).filter(segment => segment.trim());
        let fileDir = file.pathname,
            assetDir = asset.pathname;
        if (fileDir === assetDir && (file.moveTo || '') === (asset.moveTo || '')) {
            return [asset.filename, asset];
        }
        if (file.moveTo) {
            if (file.moveTo === asset.moveTo) {
                assetDir = Document.joinPosix(asset.moveTo, asset.pathname);
            }
            else {
                const moveUri = path.join(this.baseDirectory, file.moveTo, asset.relativeUri!);
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
            fileDir = Document.joinPosix(file.moveTo, file.pathname);
        }
        const prefix = splitPath(fileDir);
        const suffix = splitPath(assetDir);
        let found: Undef<boolean>;
        while (prefix.length && suffix.length && prefix[0] === suffix[0]) {
            prefix.shift();
            suffix.shift();
            found = true;
        }
        return [found ? Document.joinPosix('../'.repeat(prefix.length), suffix.join('/')) : '../'.repeat(prefix.length) + asset.relativeUri!, asset];
    }
    return ['', null];
}

function findCloudUUID(this: IFileManager, css: DocumentAsset, asset: Undef<DocumentAsset>, url: string) {
    if (asset && this.Cloud?.getStorage('upload', asset.cloudStorage)) {
        if (!asset.inlineCssCloud) {
            (css.inlineCssMap ||= {})[asset.inlineCssCloud = uuid.v4()] = url;
        }
        return asset.inlineCssCloud;
    }
    return url;
}

function transformCss(this: IFileManager, document: IChromeDocument, assets: DocumentAsset[], file: DocumentAsset, content: string, fromHTML?: boolean) {
    const cssUri = file.uri!;
    let output: Undef<string>;
    for (const item of assets) {
        if (item.base64 && !item.element && item.uri) {
            const [url] = findRelativeUri.call(this, file, item.uri);
            if (url) {
                const result = replaceUrl(output || content, item.base64, findCloudUUID.call(this, file, item, url), true);
                if (result) {
                    output = result;
                }
                else {
                    delete item.inlineCloud;
                }
            }
        }
    }
    if (output) {
        content = output;
    }
    const writeURL = (value: string, quote?: string) => {
        if (!quote) {
            quote = document.baseUrl === cssUri || value.includes('"') || fromHTML ? "'" : '"';
        }
        return `url(${quote}${value.replace(quote === '"' ? /["()]/g : /['"()]/g, (...capture) => '\\' + capture[0])}${quote})`;
    };
    const length = content.length;
    const pattern = /url\(/ig;
    let match: Null<RegExpExecArray>;
    while (match = pattern.exec(content)) {
        let url = '',
            quote: Undef<string>,
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
            if (j !== -1 && /["');>]/.test(ch)) {
                i = j;
                break;
            }
            if (ch === ')' || ch === quote) {
                if (content[i - 1] !== '\\') {
                    break;
                }
                j = i;
            }
            url += ch;
            if (ch === ':' && content.substring(i - 4, i) === 'data') {
                break;
            }
        }
        url = url.replace(/^\s*["']?\s*/, '').replace(/\s*["']?\s*$/, '');
        if (!url.startsWith('data:')) {
            const segment = content.substring(match.index, i + 1);
            let location: string,
                asset: Optional<DocumentAsset>;
            if ((!Document.isFileHTTP(url) || Document.hasSameOrigin(cssUri, url)) && ([location, asset] = findRelativeUri.call(this, file, url)) && asset) {
                output = (output || content).replace(segment, writeURL(findCloudUUID.call(this, file, asset, location), quote));
                continue;
            }
            if (asset = this.findAsset(Document.resolvePath(url, cssUri))) {
                const pathname = file.pathname;
                const count = pathname && pathname !== '/' ? pathname.split(/[\\/]/).length : 0;
                output = (output || content).replace(segment, writeURL(findCloudUUID.call(this, file, asset, (count ? '../'.repeat(count) : '') + asset.relativeUri), quote));
            }
        }
    }
    return output;
}

const escapePosix = (value: string) => value.split(/[\\/]/).map(seg => escapeRegexp(seg)).join('[\\\\/]');
const isObject = (value: unknown): value is PlainObject => typeof value === 'object' && value !== null;
const isRemoved = (item: DocumentAsset) => item.exclude || item.bundleIndex !== undefined;
const getErrorDOM = (tagName: string, tagIndex: number) => new Error(`${tagName.toUpperCase()} ${tagIndex}: Unable to parse DOM`);

class ChromeDocument extends Document implements IChromeDocument {
    public static init(this: IFileManager, instance: IChromeDocument, body: RequestBody) {
        const baseUrl = body.baseUrl;
        if (baseUrl) {
            try {
                const { origin, pathname } = new URL(baseUrl);
                instance.baseDirectory = origin + pathname.substring(0, pathname.lastIndexOf('/') + 1);
                instance.baseUrl = baseUrl;
            }
            catch {
            }
        }
        instance.unusedStyles = body.unusedStyles;
        const assets = this.assets as DocumentAsset[];
        assets.sort((a, b) => {
            if (a.bundleId && a.bundleId === b.bundleId) {
                return a.bundleIndex! - b.bundleIndex!;
            }
            if (a.uri === baseUrl) {
                return 1;
            }
            if (b.uri === baseUrl) {
                return -1;
            }
            return 0;
        });
        for (const item of assets) {
            switch (item.mimeType) {
                case '@text/html':
                    instance.htmlFiles.push(item);
                    break;
                case '@text/css':
                    instance.cssFiles.push(item);
                    break;
            }
        }
    }

    public static async using(this: IFileManager, instance: ChromeDocument, file: DocumentAsset) {
        const { format, mimeType, localUri } = file;
        switch (mimeType) {
            case '@text/html': {
                this.formatMessage(this.logType.PROCESS, 'HTML', ['Rewriting content...', path.basename(localUri!)]);
                const time = Date.now();
                const { moduleName, baseDirectory } = instance;
                const cloud = this.Cloud;
                const baseUri = file.uri!;
                const assets = this.assets.filter(item => this.hasDocument(instance, item.document)) || [];
                const database = cloud?.database.filter(item => this.hasDocument(instance, item.document) && item.element) || [];
                const domBase = new DomWriter(
                    moduleName,
                    this.getUTF8String(file, localUri),
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
                            const item = database[index];
                            const template = item.value;
                            const element = item.element!;
                            const htmlElement = new HtmlElement(moduleName, element);
                            if (typeof template === 'string') {
                                if (HtmlElement.hasInnerHTML(element.tagName)) {
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
                                    htmlElement.innerHTML = output;
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
                                            htmlElement.setAttribute(attr, value);
                                            break;
                                        }
                                    }
                                }
                            }
                            if (!domBase.write(htmlElement)) {
                                const { tagName, tagIndex } = element;
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
                            this.formatMessage(this.logType.CLOUD_DATABASE, service, ['Query had no results', table ? 'table: ' + table : ''], queryString, { titleColor: 'yellow' });
                        }
                    });
                }
                for (const item of (assets as DocumentAsset[]).filter(asset => !(asset.invalid && !asset.exclude && asset.bundleIndex === undefined)).sort((a, b) => isRemoved(a) ? -1 : isRemoved(b) ? 1 : 0)) {
                    const element = item.element;
                    if (element) {
                        const { bundleIndex, inlineContent, attributes } = item;
                        const { tagName, tagIndex } = element;
                        const htmlElement = new HtmlElement(moduleName, element, attributes);
                        if (inlineContent) {
                            const id = `<!-- ${uuid.v4()} -->`;
                            htmlElement.tagName = inlineContent;
                            htmlElement.innerHTML = id;
                            htmlElement.removeAttribute('src', 'href');
                            if (domBase.write(htmlElement, { rename: tagName === 'link' })) {
                                item.inlineContent = id;
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
                            if (tagName === 'link' || tagName === 'style') {
                                htmlElement.tagName = 'link';
                                htmlElement.setAttribute('rel', 'stylesheet');
                                htmlElement.setAttribute('href', value);
                            }
                            else {
                                htmlElement.setAttribute('src', value);
                            }
                            htmlElement.innerHTML = '';
                            if (!domBase.write(htmlElement, { rename: tagName === 'style' })) {
                                this.writeFail(['Bundle tag replacement', tagName], getErrorDOM(tagName, tagIndex));
                                delete item.inlineCloud;
                            }
                        }
                        else if (isRemoved(item) && !domBase.write(htmlElement, { remove: true })) {
                            this.writeFail(['Exclude tag removal', tagName], getErrorDOM(tagName, tagIndex));
                        }
                    }
                }
                for (const item of assets as DocumentAsset[]) {
                    if (item === file && !item.attributes || item.invalid || !item.uri && !item.attributes || item.bundleIndex !== undefined || item.inlineContent || item.content) {
                        continue;
                    }
                    const { element, base64 } = item;
                    let value = item.relativeUri!;
                    if (element) {
                        const { uri, attributes } = item;
                        const { tagName, tagIndex } = element;
                        const htmlElement = new HtmlElement(moduleName, element, attributes);
                        if (uri && item !== file) {
                            const src = [uri];
                            if (item.format === 'base64') {
                                value = uuid.v4();
                                item.inlineBase64 = value;
                                item.watch = false;
                            }
                            else if (cloud?.getStorage('upload', item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            switch (tagName) {
                                case 'a':
                                case 'area':
                                case 'base':
                                case 'link':
                                    htmlElement.setAttribute('href', value);
                                    break;
                                case 'object':
                                    htmlElement.setAttribute('data', value);
                                    break;
                                case 'video':
                                    htmlElement.setAttribute('poster', value);
                                    break;
                                case 'img':
                                case 'source': {
                                    const srcset = htmlElement.getAttribute('srcset');
                                    if (srcset) {
                                        const sameOrigin = Document.hasSameOrigin(baseUri, uri);
                                        if (sameOrigin) {
                                            let url = htmlElement.getAttribute('src');
                                            if (url && uri === Document.resolvePath(url, baseUri)) {
                                                src.push(url);
                                            }
                                            url = uri.startsWith(baseDirectory) ? uri.substring(baseDirectory.length) : uri.replace(new URL(baseUri).origin, '');
                                            if (!src.includes(url)) {
                                                src.push(url);
                                            }
                                        }
                                        let current = srcset,
                                            match: Null<RegExpExecArray>;
                                        for (const url of src) {
                                            const resolve = sameOrigin && !Document.isFileHTTP(url);
                                            const pathname = escapePosix(url);
                                            const pattern = new RegExp(`(,?\\s*)(${(resolve && item[0] !== '.' ? '(?:\\.\\.[\\\\/])*\\.\\.' + pathname + '|' : '') + pathname})([^,]*)`, 'g');
                                            while (match = pattern.exec(srcset)) {
                                                if (!resolve || uri === Document.resolvePath(match[2], baseUri)) {
                                                    current = current.replace(match[0], match[1] + value + match[3]);
                                                }
                                            }
                                        }
                                        htmlElement.setAttribute('srcset', current);
                                        if (item.format === 'srcset') {
                                            break;
                                        }
                                    }
                                }
                                default:
                                    htmlElement.setAttribute('src', value);
                                    break;
                            }
                        }
                        if (!domBase.write(htmlElement)) {
                            this.writeFail(['Element URL replacement', tagName], getErrorDOM(tagName, tagIndex));
                            delete item.inlineCloud;
                            delete item.inlineBase64;
                        }
                    }
                    else if (base64) {
                        if (cloud?.getStorage('upload', item.cloudStorage)) {
                            value = uuid.v4();
                            item.inlineCloud = value;
                        }
                        const findAll = (elem: domhandler.Element) => {
                            if (elem.tagName === 'style') {
                                return !!elem.children.find((child: domhandler.DataNode) => child.type === 'text' && child.nodeValue.includes(base64));
                            }
                            else if (elem.attribs.style?.includes(base64)) {
                                return true;
                            }
                            return false;
                        };
                        const modifyTag = (elem: domhandler.Element, source: string) => {
                            const { startIndex, endIndex } = elem;
                            return replaceUrl(source.substring(startIndex!, endIndex! + 1), base64, value, true);
                        };
                        if (!domBase.replaceAll(findAll, modifyTag)) {
                            delete item.inlineCloud;
                        }
                    }
                }
                file.sourceUTF8 = transformCss.call(this, instance, assets, file, domBase.source, true) || domBase.source;
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
                break;
            }
            case 'text/css':
            case '@text/css': {
                const unusedStyles = file.preserve !== true && instance?.unusedStyles;
                const transform = mimeType[0] === '@';
                const trailing = this.getTrailingContent(file);
                const bundle = this.getBundleContent(localUri!);
                if (!unusedStyles && !transform && !trailing && !bundle && !format) {
                    break;
                }
                let source = await instance.formatContent(this, file, this.getUTF8String(file, localUri));
                if (trailing) {
                    source += trailing;
                }
                if (bundle) {
                    source += bundle;
                }
                if (format) {
                    const result = await instance.transform('css', source, format);
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
            case 'text/javascript': {
                const trailing = this.getTrailingContent(file);
                const bundle = this.getBundleContent(localUri!);
                if (!trailing && !bundle && !format) {
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
        }
    }

    public static async finalize(this: IFileManager, instance: IChromeDocument, assets: DocumentAsset[]) {
        const base64Map: StringMap = {};
        const removeFile = (item: DocumentAsset) => {
            const localUri = item.localUri!;
            this.filesToRemove.add(localUri);
            item.invalid = true;
        };
        let tasks: Promise<unknown>[] = [];
        for (const item of assets) {
            if (item.inlineBase64 && !item.invalid) {
                tasks.push(
                    fs.readFile(item.localUri!).then((data: Buffer) => {
                        base64Map[item.inlineBase64!] = `data:${item.mimeType!};base64,${data.toString('base64').trim()}`;
                        removeFile(item);
                    })
                );
            }
        }
        if (tasks.length) {
            await Document.allSettled(tasks, ['Cache base64 <finalize>', instance.moduleName], this.errors);
            tasks = [];
        }
        const replaced = assets.filter(item => item.originalName && !item.invalid);
        const srcSet = assets.filter(item => item.srcSet);
        async function replaceContent(manager: IFileManager, file: DocumentAsset, source: string, html?: boolean, formatting?: boolean) {
            if (file.mimeType![0] === '@') {
                if (html) {
                    for (const item of srcSet) {
                        const element = item.element;
                        if (element) {
                            const htmlElement = new HtmlElement(instance.moduleName, element);
                            const images = item.srcSet!;
                            const length = images.length;
                            let value = htmlElement.getAttribute('srcset') || '',
                                i = 0;
                            while (i < length) {
                                value += (value ? ', ' : '') + images[i++] + ' ' + images[i++];
                            }
                            htmlElement.setAttribute('srcset', value);
                            const [output, err] = htmlElement.save(source);
                            if (output) {
                                source = output;
                            }
                            else if (err) {
                                instance.errors.push(err.message);
                            }
                        }
                    }
                }
                for (const id in base64Map) {
                    source = source.replace(new RegExp(id, 'g'), base64Map[id]!);
                }
                for (const asset of replaced) {
                    let pattern = `(${escapePosix(manager.getRelativeUri(asset, asset.originalName))})`;
                    if (!html) {
                        pattern += `|((?:(?:\\.\\./)*\\.\\./)|["'])${Document.joinPosix(asset.pathname, asset.originalName)}`;
                    }
                    source = source.replace(new RegExp(pattern, 'g'), (...capture) => !html && capture[2] ? capture[2] + Document.joinPosix(asset.pathname, asset.filename) : asset.relativeUri!);
                }
                if (instance.productionRelease) {
                    source = source.replace(new RegExp('(\\.\\./)*' + escapeRegexp(instance.internalServerRoot), 'g'), '');
                }
            }
            if (formatting) {
                const result = await instance.transform('html', source, file.format!);
                if (result) {
                    source = result.code;
                }
            }
            file.sourceUTF8 = source;
        }
        if (instance.productionRelease || replaced.length || srcSet.length || Object.keys(base64Map).length || assets.find(item => item.format && item.mimeType?.endsWith('text/html'))) {
            for (const item of assets) {
                if (!item.invalid) {
                    let html: Undef<boolean>,
                        formatting: Undef<boolean>;
                    switch (item.mimeType) {
                        case 'text/html':
                            if (item.format) {
                                formatting = true;
                            }
                            else {
                                break;
                            }
                        case '@text/html':
                            if (item.format) {
                                formatting = true;
                            }
                            html = true;
                        case '@text/css':
                            if (item.sourceUTF8 || item.buffer) {
                                tasks.push(replaceContent(this, item, this.getUTF8String(item), html, formatting));
                            }
                            else {
                                tasks.push(fs.readFile(item.localUri!, 'utf8').then(data => replaceContent(this, item, data, html, formatting)));
                            }
                            break;
                    }
                }
            }
        }
        if (tasks.length) {
            await Document.allSettled(tasks, ['Replace UTF-8 <finalize>', instance.moduleName], this.errors);
        }
        if (instance.htmlFiles.length) {
            const inlineMap: StringMap = {};
            for (const item of assets) {
                const inlineContent = item.inlineContent;
                if (inlineContent && inlineContent.startsWith('<!--')) {
                    inlineMap[inlineContent] = this.getUTF8String(item).trim();
                    removeFile(item);
                }
            }
            for (const item of instance.htmlFiles) {
                let content = this.getUTF8String(item);
                for (const id in inlineMap) {
                    content = content.replace(id, inlineMap[id]!);
                }
                item.sourceUTF8 = removeDatasetNamespace(instance.moduleName, content);
            }
        }
    }

    public htmlFiles: DocumentAsset[] = [];
    public cssFiles: DocumentAsset[] = [];
    public baseDirectory = '';
    public baseUrl = '';
    public internalServerRoot = '__serverroot__';
    public unusedStyles?: string[];
    public readonly moduleName = 'chrome';

    private _cloudMap!: ObjectMap<DocumentAsset>;
    private _cloudCssMap!: ObjectMap<DocumentAsset>;
    private _cloudModifiedCss!: Set<DocumentAsset>;
    private _cloudModifiedHtml!: Set<DocumentAsset>;
    private _cloudUploaded!: Set<string>;
    private _cloudEndpoint!: string;

    constructor(settings: DocumentModule, templateMap?: StandardMap, public productionRelease = false) {
        super(settings, templateMap);
    }

    async formatContent(manager: IFileManager, file: DocumentAsset, content: string): Promise<string> {
        if (file.mimeType === '@text/css') {
            const unusedStyles = this.unusedStyles;
            if (!file.preserve && unusedStyles) {
                const result = removeCss(content, unusedStyles);
                if (result) {
                    content = result;
                }
            }
            const result = transformCss.call(manager, this, manager.assets.filter((item: DocumentAsset) => manager.hasDocument(this, item.document)) as DocumentAsset[], file, content);
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
    writeImage(manager: IFileManager, data: OutputData) {
        const { file, output } = data;
        if (output) {
            const match = (file as DocumentAsset).element?.outerHTML && REGEXP_SRCSETSIZE.exec(data.command);
            if (match) {
                ((file as DocumentAsset).srcSet ||= []).push(Document.toPosix(data.baseDirectory ? output.substring(data.baseDirectory.length + 1) : output), match[1] + match[2].toLowerCase());
                return true;
            }
        }
        return false;
    }
    cloudInit(state: CloudIScopeOrigin) {
        this._cloudMap = {};
        this._cloudCssMap = {};
        this._cloudUploaded = new Set();
        this._cloudModifiedHtml = new Set();
        this._cloudModifiedCss = new Set();
        this._cloudEndpoint = '';
        if (this.htmlFiles.length === 1) {
            const upload = state.instance.getStorage('upload', this.htmlFiles[0].cloudStorage)?.upload;
            if (upload?.endpoint) {
                this._cloudEndpoint = Document.toPosix(upload.endpoint) + '/';
            }
        }
    }
    cloudObject(state: CloudIScopeOrigin, file: DocumentAsset) {
        if (file.inlineCloud) {
            this._cloudMap[file.inlineCloud] = file;
        }
        if (file.inlineCssCloud) {
            this._cloudCssMap[file.inlineCssCloud] = file;
        }
        return this.htmlFiles.includes(file) || this.cssFiles.includes(file);
    }
    async cloudUpload(state: CloudIScopeOrigin, file: DocumentAsset, url: string, active: boolean) {
        if (active) {
            const host = state.host;
            const endpoint = this._cloudEndpoint;
            let cloudUrl = url;
            if (endpoint) {
                cloudUrl = cloudUrl.replace(new RegExp(escapeRegexp(endpoint), 'g'), '');
            }
            if (file.inlineCloud) {
                for (const item of this.htmlFiles) {
                    item.sourceUTF8 = host.getUTF8String(item).replace(file.inlineCloud, cloudUrl);
                    this._cloudModifiedHtml.add(item);
                }
                this._cloudUploaded.add(file.inlineCloud);
            }
            if (file.inlineCssCloud) {
                const pattern = new RegExp(file.inlineCssCloud, 'g');
                for (const content of this.htmlFiles) {
                    content.sourceUTF8 = host.getUTF8String(content).replace(pattern, cloudUrl);
                }
                if (endpoint && cloudUrl.indexOf('/') !== -1) {
                    cloudUrl = url;
                }
                for (const item of this.cssFiles) {
                    if (item.inlineCssMap) {
                        item.sourceUTF8 = host.getUTF8String(item).replace(pattern, cloudUrl);
                        this._cloudModifiedCss.add(item);
                    }
                }
                this._cloudUploaded.add(file.inlineCssCloud);
            }
            file.cloudUrl = cloudUrl;
        }
        return false;
    }
    async cloudFinalize(state: CloudIScopeOrigin) {
        const { host, localStorage, compressed } = state;
        const modifiedCss = this._cloudModifiedCss;
        let tasks: Promise<unknown>[] = [];
        if (modifiedCss.size) {
            for (const id in this._cloudCssMap) {
                if (!this._cloudUploaded.has(id)) {
                    for (const item of this.cssFiles) {
                        const inlineCssMap = item.inlineCssMap;
                        if (inlineCssMap && inlineCssMap[id]) {
                            item.sourceUTF8 = host.getUTF8String(item).replace(new RegExp(id, 'g'), inlineCssMap[id]!);
                            modifiedCss.add(item);
                        }
                    }
                    localStorage.delete(this._cloudCssMap[id]);
                }
            }
            if (modifiedCss.size) {
                tasks.push(...Array.from(modifiedCss).map(item => fs.writeFile(item.localUri!, item.sourceUTF8, 'utf8')));
            }
            if (tasks.length) {
                await Document.allSettled(tasks, ['Update "text/css" <cloud storage>', this.moduleName], host.errors);
                tasks = [];
            }
        }
        for (const item of this.cssFiles) {
            if (item.cloudStorage) {
                if (item.compress) {
                    await host.compressFile(item);
                    compressed.push(item);
                }
                tasks.push(...Cloud.uploadAsset.call(host, state, item, 'text/css'));
            }
        }
        if (tasks.length) {
            await Document.allSettled(tasks, ['Upload "text/css" <cloud storage>', this.moduleName], host.errors);
            tasks = [];
        }
        if (this._cloudModifiedHtml.size) {
            const cloudMap = this._cloudMap;
            for (const item of this.htmlFiles) {
                let sourceUTF8 = host.getUTF8String(item);
                for (const id in cloudMap) {
                    if (!this._cloudUploaded.has(id)) {
                        const file = cloudMap[id];
                        sourceUTF8 = sourceUTF8.replace(id, file.relativeUri!);
                        localStorage.delete(file);
                    }
                }
                if (this._cloudEndpoint) {
                    sourceUTF8 = sourceUTF8.replace(this._cloudEndpoint, '');
                }
                try {
                    fs.writeFileSync(item.localUri!, sourceUTF8, 'utf8');
                }
                catch (err) {
                    this.writeFail(['Update "text/html" <cloud storage>', this.moduleName], err);
                }
                if (item.cloudStorage) {
                    if (item.compress) {
                        await host.compressFile(item);
                        compressed.push(item);
                    }
                    tasks.push(...Cloud.uploadAsset.call(host, state, item, 'text/html', true));
                }
            }
            if (tasks.length) {
                await Document.allSettled(tasks, ['Upload "text/html" <cloud storage>', this.moduleName], host.errors);
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