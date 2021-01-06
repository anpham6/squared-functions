import path = require('path');
import fs = require('fs-extra');
import mime = require('mime-types');
import escapeRegexp = require('escape-string-regexp');
import uuid = require('uuid');

import Node from '../../node';
import Document from '../../document';

type IFileManager = functions.IFileManager;
type IDocument = functions.IDocument;

type RequestBody = functions.RequestBody;
type ExternalAsset = functions.ExternalAsset;

type DocumentModule = functions.ExtendedSettings.DocumentModule;

interface IChromeDocument extends IDocument {
    productionRelease: boolean;
    unusedStyles?: string[];
}

const REGEXP_INDEXOBJECT = /([^[.\s]+)((?:\s*\[[^\]]+\]\s*)+)?\s*\.?\s*/g;
const REGEXP_INDEXARRAY = /\[\s*(["'])?(.+?)\1\s*\]/g;
const REGEXP_TAGSTART = /^(\s*<\s*[\w-]+)(\s*)/;
const REGEXP_TAGTEXT = /^\s*<([\w-]+)[^>]*>[\S\s]*?<\/\1>\s*$/;
const REGEXP_TRAILINGCONTENT = /(\s*)<(script|style)[^>]*>([\s\S]*?)<\/\2>\n*/g;
const REGEXP_DBCOLUMN = /\$\{\s*(\w+)\s*\}/g;
const REGEXP_FILEEXCLUDE = /\s*<(script|link|style).+?data-chrome-file="exclude"[\s\S]*?<\/\1>\n*/g;
const REGEXP_FILEEXCLUDECLOSED = /\s*<(script|link).+?data-chrome-file="exclude"[^>]*>\n*/g;
const REGEXP_SCRIPTTEMPLATE = /\s*<script.+?data-chrome-template="([^"]|(?<=\\)")*"[\s\S]*?<\/script>\n*/g;
const REGEXP_CHROMEATTRIBUTE = /\s+data-(use|chrome-[\w-]+)="([^"]|(?<=\\)")*"/g;
const REGEXP_CSSURL = /url\(\s*([^)]+)\s*\)/g;

function removeFileCommands(value: string) {
    return value
        .replace(REGEXP_FILEEXCLUDE, '')
        .replace(REGEXP_FILEEXCLUDECLOSED, '')
        .replace(REGEXP_SCRIPTTEMPLATE, '')
        .replace(REGEXP_CHROMEATTRIBUTE, '');
}

function getObjectValue(data: PlainObject, key: string, joinString = ' ') {
    REGEXP_INDEXOBJECT.lastIndex = 0;
    let found = false,
        value: unknown = data,
        match: Null<RegExpMatchArray>;
    while (match = REGEXP_INDEXOBJECT.exec(key)) {
        if (isObject(value)) {
            value = value[match[1]];
            if (match[2]) {
                REGEXP_INDEXARRAY.lastIndex = 0;
                let index: Null<RegExpMatchArray>;
                while (index = REGEXP_INDEXARRAY.exec(match[2])) {
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

function findClosingTag(outerHTML: string): [string, string, string] {
    const forward = outerHTML.split('>');
    const opposing = outerHTML.split('<');
    if (opposing.length === 1 || forward.length === 1) {
        const match = /^(\s*)<([\w-]+)(.*?)\/?>(\s*)$/.exec(outerHTML);
        if (match) {
            return [match[1] + '<' + match[2] + match[3] + '>', `</${match[2]}>` + match[4], ''];
        }
    }
    else if (opposing.length === 2 && forward.length === 2 && REGEXP_TAGTEXT.test(outerHTML)) {
        return [forward[0] + '>', '<' + opposing[1], forward[1] + opposing[0]];
    }
    else {
        const value = outerHTML.replace(/\s+$/, '');
        const length = value.length;
        let opening = '',
            start = -1;
        for (let i = 0, quote = ''; i < length; ++i) {
            const ch = value[i];
            if (ch === '=') {
                if (!quote) {
                    switch (value[i + 1]) {
                        case '"':
                            quote = '"';
                            start = ++i;
                            break;
                        case "'":
                            quote = "'";
                            start = ++i;
                            break;
                    }
                }
            }
            else if (ch === quote) {
                quote = '';
            }
            else if (ch === '>' && !quote) {
                opening = outerHTML.substring(0, i + 1);
                break;
            }
        }
        if (!opening && start !== -1) {
            for (let j = start + 1; j < length; ++j) {
                if (outerHTML[j] === '>') {
                    opening = outerHTML.substring(0, j + 1);
                    break;
                }
            }
        }
        if (opening) {
            const index = outerHTML.lastIndexOf('<');
            return [opening, outerHTML.substring(index), outerHTML.substring(opening.length + 1, index)];
        }
    }
    return ['', '', ''];
}

function replaceUri(source: string, segments: string[], value: string, matchSingle = true, base64?: boolean) {
    let output: Undef<string>;
    for (let segment of segments) {
        segment = !base64 ? escapePosix(segment) : `[^"',]+,\\s*` + segment;
        const pattern = new RegExp(`(src|href|data|poster=)?(["'])?(\\s*)${segment}(\\s*)\\2?`, 'g');
        let match: Null<RegExpExecArray>;
        while (match = pattern.exec(source)) {
            output = (output || source).replace(match[0], match[1] ? match[1].toLowerCase() + `"${value}"` : (match[2] || '') + match[3] + value + match[4] + (match[2] || ''));
            if (matchSingle && output !== source) {
                break;
            }
        }
    }
    return output;
}

function removeCss(source: string, styles: string[]) {
    let output: Undef<string>,
        pattern: Undef<RegExp>,
        match: Null<RegExpExecArray>;
    for (let value of styles) {
        value = value.replace(/\./g, '\\.');
        pattern = new RegExp(`^\\s*${value}\\s*\\{[^}]*\\}\\n*`, 'gm');
        while (match = pattern.exec(source)) {
            output = (output || source).replace(match[0], '');
        }
        if (output) {
            source = output;
        }
        pattern = new RegExp(`^[^,]*(,?\\s*${value}\\s*[,{](\\s*)).*?\\{?`, 'gm');
        while (match = pattern.exec(source)) {
            const segment = match[1];
            let replaceWith = '';
            if (segment.trim().endsWith('{')) {
                replaceWith = ' {' + match[2];
            }
            else if (segment[0] === ',') {
                replaceWith = ', ';
            }
            output = (output || source).replace(match[0], match[0].replace(segment, replaceWith));
        }
        if (output) {
            source = output;
        }
    }
    return output;
}

function transformCss(this: IFileManager, file: ExternalAsset, content: string) {
    const getCloudUUID = (item: Undef<ExternalAsset>, url: string) => {
        if (item && this.Cloud?.getStorage('upload', item.cloudStorage)) {
            if (!item.inlineCssCloud) {
                (file.inlineCssMap ||= {})[item.inlineCssCloud = uuid.v4()] = url;
            }
            return item.inlineCssCloud;
        }
        return url;
    };
    const cssUri = file.uri!;
    let output: Undef<string>;
    for (const item of this.assets) {
        if (item.base64 && item.uri && Document.fromSameOrigin(cssUri, item.uri) && !item.outerHTML && !item.invalid) {
            const url = this.findRelativePath(file, item.uri);
            if (url) {
                const replaced = replaceUri(output || content, [item.base64.replace(/\+/g, '\\+')], getCloudUUID(item, url), false, true);
                if (replaced) {
                    output = replaced;
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
    REGEXP_CSSURL.lastIndex = 0;
    const baseUri = this.baseAsset?.uri;
    let match: Null<RegExpExecArray>;
    while (match = REGEXP_CSSURL.exec(content)) {
        const url = match[1].replace(/^["']\s*/, '').replace(/\s*["']$/, '');
        if (!Node.isFileURI(url) || Document.fromSameOrigin(cssUri, url)) {
            let location = this.findRelativePath(file, url, true);
            if (location) {
                const uri = Node.resolvePath(url, cssUri);
                output = (output || content).replace(match[0], `url(${getCloudUUID(uri ? this.findAsset(uri) : undefined, location)})`);
            }
            else if (baseUri) {
                location = Node.resolvePath(url, baseUri);
                if (location) {
                    const asset = this.findAsset(location);
                    if (asset) {
                        location = this.findRelativePath(file, location);
                        if (location) {
                            output = (output || content).replace(match[0], `url(${getCloudUUID(asset, location)})`);
                        }
                    }
                }
            }
        }
        else {
            const asset = this.findAsset(url);
            if (asset) {
                const pathname = file.pathname;
                const count = pathname && pathname !== '/' && !file.baseUrl ? pathname.split(/[\\/]/).length : 0;
                output = (output || content).replace(match[0], `url(${getCloudUUID(asset, (count ? '../'.repeat(count) : '') + asset.relativePath)})`);
            }
        }
    }
    return output;
}

const escapePosix = (value: string) => value.replace(/[\\/]/g, '[\\\\/]');
const getRelativePath = (file: ExternalAsset, filename = file.filename) => Node.joinPosix(file.moveTo, file.pathname, filename);
const isObject = (value: unknown): value is PlainObject => typeof value === 'object' && value !== null;

class ChromeDocument extends Document implements IChromeDocument {
    public static init(this: IFileManager) {
        this.assets.sort((a, b) => {
            if (a.bundleId && a.bundleId === b.bundleId) {
                return a.bundleIndex! - b.bundleIndex!;
            }
            if (a === this.baseAsset) {
                return 1;
            }
            if (b === this.baseAsset) {
                return -1;
            }
            return 0;
        });
    }

    public static async using(this: IFileManager, document: IChromeDocument, file: ExternalAsset) {
        const { format, mimeType, fileUri } = file;
        switch (mimeType) {
            case '@text/html': {
                let html = this.getUTF8String(file, fileUri),
                    source = html,
                    current = '',
                    match: Null<RegExpExecArray>;
                const minifySpace = (value: string) => value.replace(/[\s/]+/g, '');
                const getOuterHTML = (css: boolean, value: string) => css ? `<link rel="stylesheet" href="${value}" />` : `<script src="${value}"></script>`;
                const formatTag = (outerHTML: string) => outerHTML.replace(/"\s*>$/, '" />');
                const formatAttr = (key: string, value?: Null<string>) => value !== undefined ? key + (value !== null ? `="${value}"` : '') : '';
                const replaceTry = (outerHTML: string, replaceWith: string) => {
                    source = source.replace(outerHTML, replaceWith);
                    if (current === source) {
                        source = source.replace(formatTag(outerHTML), replaceWith);
                    }
                };
                const replaceMinify = (outerHTML: string, replaceWith: string, content?: string) => {
                    if (current === source && (match = /<(\s*[\w-]+)/.exec(outerHTML))) {
                        const openTag: number[] = [];
                        let index = 0;
                        while ((index = html.indexOf(match[0], index)) !== -1) {
                            openTag.push(index++);
                        }
                        const open = openTag.length;
                        if (open) {
                            const closeTag: number[] = [];
                            const tag = new RegExp(`</\\s*${match[1].trim()}\\s*>`, 'ig');
                            while (match = tag.exec(html)) {
                                closeTag.push(match.index + match[0].length);
                            }
                            const close = closeTag.length;
                            if (close) {
                                content &&= minifySpace(content);
                                outerHTML = minifySpace(outerHTML);
                                for (let i = 0; i < open; ++i) {
                                    let j = 0,
                                        valid: Undef<boolean>;
                                    if (i === close - 1 && open === close) {
                                        j = i;
                                        valid = true;
                                    }
                                    else {
                                        found: {
                                            const k = openTag[i];
                                            let start = i + 1;
                                            for ( ; j < close; ++j) {
                                                const l = closeTag[j];
                                                if (l > k) {
                                                    for (let m = start; m < open; ++m) {
                                                        const n = openTag[m];
                                                        if (n < l) {
                                                            ++start;
                                                            break;
                                                        }
                                                        else if (n > l) {
                                                            valid = true;
                                                            break found;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    if (valid) {
                                        const outerText = html.substring(openTag[i], closeTag[j]);
                                        if (outerHTML === minifySpace(outerText) || content && content === minifySpace(findClosingTag(outerText)[2])) {
                                            source = source.replace(replaceWith ? outerText : new RegExp('\\s*' + escapeRegexp(outerText) + '\\n*'), replaceWith);
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    html = source;
                };
                const cloud = this.Cloud;
                if (cloud && cloud.database) {
                    const items = cloud.database.filter(item => item.element?.outerHTML);
                    const cacheKey = uuid.v4();
                    (await Promise.all(items.map(item => cloud.getDatabaseRows(item, cacheKey).catch(() => [])))).forEach((result, index) => {
                        if (result.length) {
                            const item = items[index];
                            const outerHTML = item.element!.outerHTML!;
                            const template = item.value;
                            let replaceWith = '';
                            if (typeof template === 'string') {
                                const [opening, closing] = findClosingTag(outerHTML);
                                if (opening && closing) {
                                    let output = '';
                                    for (const row of result) {
                                        REGEXP_DBCOLUMN.lastIndex = 0;
                                        let value = template;
                                        while (match = REGEXP_DBCOLUMN.exec(template)) {
                                            value = value.replace(match[0], getObjectValue(row, match[1]));
                                        }
                                        output += value;
                                    }
                                    replaceWith = opening + output + closing;
                                }
                            }
                            else {
                                replaceWith = outerHTML;
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
                                            const replacement = ' ' + formatAttr(attr, value);
                                            match = new RegExp(`\\s*${attr}="(?:[^"]|(?<=\\\\)")*"`).exec(replaceWith);
                                            replaceWith = match ? replaceWith.replace(match[0], replacement) : replaceWith.replace(/^(\s*<[\w-]+)(\s*)/, (...capture) => capture[1] + replacement + (capture[2] ? ' ' : ''));
                                            break;
                                        }
                                    }
                                }
                            }
                            if (replaceWith && replaceWith !== outerHTML) {
                                current = source;
                                replaceTry(outerHTML, replaceWith);
                                replaceMinify(outerHTML, replaceWith);
                                if (current !== source) {
                                    for (const asset of this.assets) {
                                        if (asset.outerHTML === outerHTML) {
                                            asset.outerHTML = replaceWith;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        else {
                            const { service, table, id, query } = items[index];
                            let queryString = '';
                            if (id) {
                                queryString = 'id: ' + id;
                            }
                            else if (query) {
                                queryString = typeof query !== 'string' ? JSON.stringify(query) : query;
                            }
                            this.formatMessage(this.logType.CLOUD_DATABASE, service, ['Query had no results', 'table: ' + table], queryString, { titleColor: 'yellow' });
                        }
                    });
                }
                const baseUri = file.uri!;
                for (const item of this.assets) {
                    if (item.invalid && !item.exclude) {
                        continue;
                    }
                    const { outerHTML, trailingContent } = item;
                    if (trailingContent) {
                        REGEXP_TRAILINGCONTENT.lastIndex = 0;
                        const content = trailingContent.map(innerHTML => minifySpace(innerHTML.value));
                        while (match = REGEXP_TRAILINGCONTENT.exec(html)) {
                            if (content.includes(minifySpace(match[3]))) {
                                source = source.replace(match[0], '');
                            }
                        }
                        html = source;
                    }
                    if (outerHTML) {
                        current = source;
                        const { content, bundleIndex, inlineContent, attributes = {} } = item;
                        let output = '';
                        if (inlineContent) {
                            const id = `<!-- ${uuid.v4()} -->`;
                            let replaceWith = '<' + inlineContent;
                            for (const key in attributes) {
                                replaceWith += formatAttr(key, attributes[key]);
                            }
                            replaceWith += `>${id}</${inlineContent}>`;
                            replaceTry(outerHTML, replaceWith);
                            replaceMinify(outerHTML, replaceWith, content);
                            if (current !== source) {
                                item.inlineContent = id;
                                item.watch = false;
                                item.outerHTML = replaceWith;
                                continue;
                            }
                        }
                        else if (bundleIndex === 0 || bundleIndex === -1) {
                            let value: string;
                            if (cloud && cloud.getStorage('upload', item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            else {
                                value = item.relativePath!;
                            }
                            output = getOuterHTML(/^\s*<link\b/.test(outerHTML) || !!item.mimeType?.endsWith('/css'), value);
                        }
                        else if (item.exclude || bundleIndex !== undefined) {
                            source = source.replace(new RegExp(`\\s*${escapeRegexp(outerHTML)}\\n*`), '');
                            if (current === source) {
                                source = source.replace(new RegExp(`\\s*${escapeRegexp(formatTag(outerHTML))}\\n*`), '');
                                replaceMinify(outerHTML, '', content);
                            }
                            else {
                                html = source;
                            }
                            continue;
                        }
                        if (Object.keys(attributes).length || output) {
                            output ||= outerHTML;
                            for (const key in attributes) {
                                const value = attributes[key];
                                if (match = new RegExp(`(\\s*)${key}(?:="([^"]|(?<=\\\\)")*"|\b)`).exec(output)) {
                                    output = output.replace(match[0], value !== undefined ? (match[1] ? ' ' : '') + formatAttr(key, value) : '');
                                }
                                else if (value !== undefined && (match = REGEXP_TAGSTART.exec(output))) {
                                    output = output.replace(match[0], match[1] + ' ' + formatAttr(key, value) + (match[2] ? ' ' : ''));
                                }
                            }
                            if (output !== outerHTML) {
                                replaceTry(outerHTML, output);
                                replaceMinify(outerHTML, output, content);
                                if (current !== source) {
                                    item.outerHTML = output;
                                    continue;
                                }
                            }
                            delete item.inlineCloud;
                        }
                    }
                }
                const baseUrl = this.baseAsset?.baseUrl;
                for (const item of this.assets) {
                    if (item === file || item.content || item.bundleIndex !== undefined || item.inlineContent || !item.uri || item.invalid) {
                        continue;
                    }
                    found: {
                        const { uri, outerHTML } = item;
                        current = source;
                        if (outerHTML) {
                            item.mimeType ||= mime.lookup(uri).toString();
                            const segments = [uri];
                            let value = item.relativePath!,
                                relativePath: Undef<string>,
                                ascending: Undef<boolean>;
                            if (baseUrl) {
                                relativePath = uri.replace(baseUrl, '');
                                if (relativePath === uri) {
                                    relativePath = '';
                                }
                            }
                            if (!relativePath && Document.fromSameOrigin(baseUri, uri)) {
                                relativePath = path.join(item.pathname, path.basename(uri));
                                ascending = true;
                            }
                            if (relativePath) {
                                segments.push(relativePath);
                            }
                            if (cloud && cloud.getStorage('upload', item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            else if (item.mimeType.startsWith('image/') && item.format === 'base64') {
                                value = uuid.v4();
                                item.inlineBase64 = value;
                                item.watch = false;
                            }
                            const innerContent = outerHTML.replace(/^\s*<\s*/, '').replace(/\s*\/?\s*>([\S\s]*<\/[\s\w]+>)?\s*$/, '');
                            const replaced = replaceUri(innerContent, segments, value);
                            if (replaced) {
                                source = source.replace(innerContent, replaced);
                                if (current === source) {
                                    source = source.replace(new RegExp(escapeRegexp(innerContent).replace(/\s+/g, '\\s+')), replaced);
                                }
                                if (current !== source) {
                                    item.outerHTML = outerHTML.replace(innerContent, replaced);
                                    html = source;
                                    break found;
                                }
                            }
                            if (relativePath) {
                                const directory = new RegExp(`(["'\\s,=])(${(ascending ? '(?:(?:\\.\\.)?(?:[\\\\/]\\.\\.|\\.\\.[\\\\/]|[\\\\/])*)?' : '') + escapePosix(relativePath)})`, 'g');
                                while (match = directory.exec(html)) {
                                    if (uri === Node.resolvePath(match[2], baseUri)) {
                                        const src = match[1] + value;
                                        source = source.replace(match[0], src);
                                        if (current !== source) {
                                            item.outerHTML = outerHTML.replace(match[0], src);
                                            html = source;
                                            break found;
                                        }
                                    }
                                }
                            }
                            delete item.inlineCloud;
                            delete item.inlineBase64;
                        }
                        else if (item.base64) {
                            let value = item.relativePath!;
                            if (cloud && cloud.getStorage('upload', item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            const result = replaceUri(source, [item.base64.replace(/\+/g, '\\+')], value, false, true);
                            if (result) {
                                source = result;
                                html = source;
                            }
                            else {
                                delete item.inlineCloud;
                            }
                        }
                    }
                }
                source = removeFileCommands(transformCss.call(this, file, source) || source);
                if (format) {
                    const result = await document.transform('html', format, source, this.createSourceMap(file, source));
                    if (result) {
                        file.sourceUTF8 = result[0];
                        break;
                    }
                }
                file.sourceUTF8 = source;
                break;
            }
            case 'text/html':
                if (format) {
                    const source = this.getUTF8String(file, fileUri);
                    const result = await document.transform('html', format, source, this.createSourceMap(file, source));
                    if (result) {
                        file.sourceUTF8 = result[0];
                    }
                }
                break;
            case 'text/css':
            case '@text/css': {
                const unusedStyles = file.preserve !== true && document?.unusedStyles;
                const transform = mimeType[0] === '@';
                const trailing = await this.getTrailingContent(file);
                const bundle = this.joinAllContent(fileUri!);
                if (!unusedStyles && !transform && !trailing && !bundle && !format) {
                    break;
                }
                let source = this.getUTF8String(file, fileUri),
                    modified = false;
                if (unusedStyles) {
                    const result = removeCss(source, unusedStyles);
                    if (result) {
                        source = result;
                        modified = true;
                    }
                }
                if (transform) {
                    const result = transformCss.call(this, file, source);
                    if (result) {
                        source = result;
                        modified = true;
                    }
                }
                if (trailing) {
                    source += trailing;
                    modified = true;
                }
                if (bundle) {
                    source += bundle;
                }
                if (format) {
                    const result = await document.transform('css', format, source, this.createSourceMap(file, source));
                    if (result) {
                        if (result[1].size) {
                            this.writeSourceMap(result, file, source, modified);
                        }
                        source = result[0];
                    }
                }
                file.sourceUTF8 = source;
                break;
            }
            case 'text/javascript': {
                const trailing = await this.getTrailingContent(file);
                const bundle = this.joinAllContent(fileUri!);
                if (!trailing && !bundle && !format) {
                    break;
                }
                let source = this.getUTF8String(file, fileUri),
                    modified = false;
                if (trailing) {
                    source += trailing;
                    modified = true;
                }
                if (bundle) {
                    source += bundle;
                }
                if (format) {
                    const result = await document.transform('js', format, source, this.createSourceMap(file, source));
                    if (result) {
                        if (result[1].size) {
                            this.writeSourceMap(result, file, source, modified);
                        }
                        source = result[0];
                    }
                }
                file.sourceUTF8 = source;
                break;
            }
        }
    }

    public static async finalize(this: IFileManager, document: IChromeDocument) {
        let tasks: Promise<unknown>[] = [];
        const inlineMap: StringMap = {};
        const base64Map: StringMap = {};
        const htmlFiles = this.getHtmlPages();
        const removeFile = (item: ExternalAsset) => {
            const fileUri = item.fileUri!;
            this.filesToRemove.add(fileUri);
            item.invalid = true;
        };
        if (htmlFiles.length) {
            for (const item of this.assets) {
                if (item.inlineContent && item.inlineContent.startsWith('<!--')) {
                    inlineMap[item.inlineContent] = this.getUTF8String(item).trim();
                    removeFile(item);
                }
            }
            if (Object.keys(inlineMap).length) {
                for (const item of htmlFiles) {
                    let content = this.getUTF8String(item);
                    for (const id in inlineMap) {
                        content = content.replace(id, inlineMap[id]!);
                    }
                    item.sourceUTF8 = content;
                }
            }
        }
        for (const item of this.assets) {
            if (item.inlineBase64 && !item.invalid) {
                tasks.push(
                    fs.readFile(item.fileUri!).then((data: Buffer) => {
                        base64Map[item.inlineBase64!] = `data:${item.mimeType!};base64,${data.toString('base64').trim()}`;
                        removeFile(item);
                    })
                );
            }
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => this.writeFail(['Cache base64', 'finalize'], err));
            tasks = [];
        }
        const replaced = this.assets.filter(item => item.originalName && !item.invalid);
        const srcSet = this.assets.filter(item => item.srcSet);
        const productionRelease = document.productionRelease;
        if (replaced.length || srcSet.length || Object.keys(base64Map).length || productionRelease) {
            const outerContent: { item: ExternalAsset; outerHTML: string }[] = [];
            const replaceContent = (file: ExternalAsset, source: string, content: boolean) => {
                if (content) {
                    let current = source;
                    for (const { item, outerHTML } of outerContent) {
                        source = source.replace(item.outerHTML!, outerHTML);
                        if (current !== source) {
                            item.outerHTML = outerHTML;
                            current = source;
                        }
                    }
                }
                for (const id in base64Map) {
                    source = source.replace(new RegExp(id, 'g'), base64Map[id]!);
                }
                for (const asset of replaced) {
                    source = source.replace(new RegExp(escapePosix(getRelativePath(asset, asset.originalName)), 'g'), asset.relativePath!);
                }
                if (productionRelease) {
                    source = source.replace(new RegExp('(\\.\\./)*' + document.serverRoot, 'g'), '');
                }
                file.sourceUTF8 = source;
            };
            for (const item of srcSet) {
                const images = item.srcSet;
                if (images) {
                    let outerHTML = item.outerHTML!,
                        value = 'srcset="',
                        start = true,
                        match = /(\s*)srcset="([^"]|(?<=\\)")"/i.exec(outerHTML);
                    if (match) {
                        value = match[2].trim();
                        start = false;
                    }
                    const length = images.length;
                    let i = 0;
                    while (i < length) {
                        value += (!start ? ', ' : '') + images[i++] + ' ' + images[i++];
                        start = false;
                    }
                    value += '"';
                    if (match) {
                        outerHTML = outerHTML.replace(match[0], (match[1] ? ' ' : '') + value);
                    }
                    else if (match = REGEXP_TAGSTART.exec(outerHTML)) {
                        outerHTML = outerHTML.replace(match[0], match[1] + ' ' + value + (match[2] ? ' ' : ''));
                    }
                    else {
                        continue;
                    }
                    outerContent.push({ item, outerHTML });
                }
            }
            for (const item of this.assets) {
                if (!item.invalid) {
                    let content = false;
                    switch (item.mimeType) {
                        case '@text/html':
                            content = true;
                        case '@text/css':
                            if (item.sourceUTF8 || item.buffer) {
                                replaceContent(item, this.getUTF8String(item), content);
                            }
                            else {
                                tasks.push(fs.readFile(item.fileUri!, 'utf8').then(data => replaceContent(item, data, content)));
                            }
                            break;
                    }
                }
            }
        }
        if (tasks.length) {
            await Promise.all(tasks).catch(err => this.writeFail(['Replace UTF-8', 'finalize'], err));
        }
    }

    public static async formatContent(this: IFileManager, document: IChromeDocument, file: ExternalAsset, content: string) {
        if (file.mimeType === '@text/css') {
            const unusedStyles = document.unusedStyles;
            if (!file.preserve && unusedStyles) {
                const result = removeCss(content, unusedStyles);
                if (result) {
                    content = result;
                }
            }
            const result = transformCss.call(this, file, content);
            if (result) {
                content = result;
            }
        }
        return content;
    }

    public documentName = 'chrome';
    public unusedStyles?: string[];

    constructor (body: RequestBody, settings?: DocumentModule, public productionRelease = false) {
        super(body, settings);
        this.unusedStyles = body.unusedStyles;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChromeDocument;
    module.exports.default = ChromeDocument;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default ChromeDocument;