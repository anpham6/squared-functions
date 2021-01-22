import type { CloudDatabase, ElementAction, ElementIndex } from '../../types/lib/squared';

import type { IFileManager } from '../../types/lib';
import type { FileData } from '../../types/lib/asset';
import type { SourceMapOutput } from '../../types/lib/document';
import type { OutputData } from '../../types/lib/image';
import type { DocumentModule } from '../../types/lib/module';
import type { RequestBody } from '../../types/lib/node';

import type { CloudIScopeOrigin } from '../../cloud';
import type { DocumentAsset, IChromeDocument } from './document';

import fs = require('fs-extra');
import escapeRegexp = require('escape-string-regexp');
import uuid = require('uuid');

import Document from '../../document';
import Cloud from '../../cloud';

const REGEXP_SRCSETSIZE = /~\s*([\d.]+)\s*([wx])/i;

function getElementSrc(outerHTML: string) {
    const match = /\b(?:src|href|data|poster)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(outerHTML);
    if (match) {
        return (match[1] || match[2] || match[3]).trim();
    }
}

function removeFileCommands(value: string) {
    if (value.includes('data-chrome')) {
        return value
            .replace(/(\s*)<\s*(script|link|style).+?data-chrome-file\s*=\s*(["'])?exclude\3[\S\s]*?<\/\s*\2\s*>[ \t]*((?:\r?\n)*)/ig, (...capture) => getNewlineString(capture[1], capture[4]))
            .replace(/(\s*)<\s*(?:script|link).+?data-chrome-file\s*=\s*(["'])?exclude\2[^>]*>[ \t]*((?:\r?\n)*)/ig, (...capture) => getNewlineString(capture[1], capture[3]))
            .replace(/(\s*)<\s*script.+?data-chrome-template\s*=\s*(?:"[^"]*"|'[^']*')[\S\s]*?<\/\s*script\s*>[ \t]*((?:\r?\n)*)/ig, (...capture) => getNewlineString(capture[1], capture[2]))
            .replace(/\s+data-chrome-[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*')/g, '');
    }
    return value;
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

function isSpace(ch: string) {
    const n = ch.charCodeAt(0);
    return n === 32 || n < 14 && n > 8;
}

function findClosingTag(tagName: string, outerHTML: string, closed = true): [string, string, string] {
    const forward = outerHTML.split('>');
    const opposing = outerHTML.split('<');
    if (opposing.length === 1 || forward.length === 1) {
        if (closed || tagName === 'HTML') {
            return [outerHTML, '', ''];
        }
        switch (tagName) {
            case 'AREA':
            case 'BASE':
            case 'BR':
            case 'COL':
            case 'EMBED':
            case 'HR':
            case 'IMG':
            case 'INPUT':
            case 'LINK':
            case 'META':
            case 'PARAM':
            case 'SOURCE':
            case 'TRACK':
            case 'WBR':
                break;
            default: {
                const match = /^<\s*([^\s/>]+)(.*?)\/?>$/.exec(outerHTML);
                if (match) {
                    return ['<' + match[1] + match[2] + '>', `</${match[1]}>`, ''];
                }
            }
            break;
        }
    }
    else if (opposing.length === 2 && forward.length === 2 && /^<\s*([^\s/>]+)[\S\s]+?<\/\s*\1\s*>$/i.test(outerHTML)) {
        return [forward[0] + '>', '<' + opposing[1], forward[1] + opposing[0]];
    }
    else {
        const length = outerHTML.length;
        let opening = '',
            start = -1;
        for (let i = 0, quote = ''; i < length; ++i) {
            const ch = outerHTML[i];
            if (ch === '=') {
                if (!quote) {
                    while (isSpace(outerHTML[++i])) {}
                    switch (outerHTML[i]) {
                        case '"':
                            quote = '"';
                            start = i;
                            break;
                        case "'":
                            quote = "'";
                            start = i;
                            break;
                        case '>':
                            --i;
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
            return [opening, outerHTML.substring(index), outerHTML.substring(opening.length, index)];
        }
    }
    return ['', '', ''];
}

function replaceSrc(outerHTML: string, src: string[], value: string, base64: boolean, baseUri?: string[]) {
    let html = outerHTML,
        result: Undef<string>;
    for (const item of src) {
        let match = new RegExp(`\\b(src|href|data|poster)\\s*=\\s*(["'])?\\s*${!base64 ? escapePosix(item) : escapeRegexp(item)}\\s*\\2`, 'i').exec(html);
        if (match) {
            result = (result || html).replace(match[0], match[1].toLowerCase() + `="${value}"`);
            html = result;
        }
        if (!base64) {
            match = /srcset\s*=\s*(["'])([\S\s]+?)\1/i.exec(html);
            if (match) {
                const current = match[2];
                const ascending = baseUri && /[.\\/]/.test(item[0]);
                let source = current,
                    found: Undef<boolean>;
                const pattern = new RegExp(`(${(ascending ? '(?:(?:\\.\\.)?(?:[\\\\/]\\.\\.|\\.\\.[\\\\/]|[\\\\/])*)?' : '') + escapePosix(item)})([^,]*)`, 'g');
                while (match = pattern.exec(current)) {
                    if (!ascending || baseUri![1] === Document.resolvePath(match[1], baseUri![0])) {
                        source = source.replace(match[0], value + match[2]);
                        found = true;
                    }
                }
                if (found) {
                    result = (result || html).replace(current, source);
                    html = result;
                }
            }
        }
    }
    return result;
}

function replaceUrl(css: string, src: string, value: string, base64: boolean) {
    const pattern = new RegExp(`\\b[Uu][Rr][Ll]\\(\\s*(["']*)\\s*${!base64 ? escapePosix(src) : `[^"',]+,\\s*` + src.replace(/\+/g, '\\+')}\\s*\\1\\s*\\)`, 'g');
    let output: Undef<string>,
        match: Null<RegExpExecArray>;
    while (match = pattern.exec(css)) {
        output = (output || css).replace(match[0], 'url(' + match[1] + value + match[1] + ')');
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

function getRootDirectory(location: string, asset: string): [string[], string[]] {
    const locationDir = location.split(/[\\/]/);
    const assetDir = asset.split(/[\\/]/);
    while (locationDir.length && assetDir.length && locationDir[0] === assetDir[0]) {
        locationDir.shift();
        assetDir.shift();
    }
    return [locationDir.filter(value => value), assetDir];
}

function findRelativeUri(this: IFileManager, file: DocumentAsset, location: string, baseDirectory?: string, partial?: boolean) {
    const origin = file.uri!;
    let asset: Undef<DocumentAsset>;
    if (partial) {
        location = Document.resolvePath(location, origin);
        if (location) {
            asset = this.findAsset(location);
        }
    }
    else {
        asset = this.findAsset(location);
    }
    if (asset) {
        try {
            const baseDir = (file.rootDir || '') + file.pathname;
            if (Document.hasSameOrigin(origin, asset.uri!)) {
                const rootDir = asset.rootDir;
                if (asset.moveTo) {
                    if (file.moveTo === asset.moveTo) {
                        return Document.joinPosix(asset.pathname, asset.filename);
                    }
                }
                else if (rootDir) {
                    if (baseDir === rootDir + asset.pathname) {
                        return asset.filename;
                    }
                    else if (baseDir === rootDir) {
                        return Document.joinPosix(asset.pathname, asset.filename);
                    }
                }
                else {
                    const [originDir, uriDir] = getRootDirectory(new URL(origin).pathname, new URL(asset.uri!).pathname);
                    return '../'.repeat(originDir.length - 1) + uriDir.join('/');
                }
            }
            if (baseDirectory && Document.hasSameOrigin(origin, baseDirectory)) {
                const [originDir] = getRootDirectory(Document.joinPosix(baseDir, file.filename), new URL(baseDirectory).pathname);
                return '../'.repeat(originDir.length - 1) + asset.relativeUri;
            }
        }
        catch {
        }
    }
}

function getCssUrlOrCloudUUID(this: IFileManager, file: DocumentAsset, image: Undef<DocumentAsset>, url: string) {
    if (image && this.Cloud?.getStorage('upload', image.cloudStorage)) {
        if (!image.inlineCssCloud) {
            (file.inlineCssMap ||= {})[image.inlineCssCloud = uuid.v4()] = url;
        }
        return image.inlineCssCloud;
    }
    return url;
}

function transformCss(this: IFileManager, document: IChromeDocument, file: DocumentAsset, content: string) {
    const cssUri = file.uri!;
    let output: Undef<string>;
    for (const item of this.assets as DocumentAsset[]) {
        if (item.base64 && !item.element && item.uri && Document.hasSameOrigin(cssUri, item.uri)) {
            const url = findRelativeUri.call(this, file, item.uri, document.baseDirectory);
            if (url) {
                const replaced = replaceUrl(output || content, item.base64, getCssUrlOrCloudUUID.call(this, file, item, url), true);
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
    const pattern = /url\(([^)]+)\)/g;
    let match: Null<RegExpExecArray>;
    while (match = pattern.exec(content)) {
        const url = match[1].trim().replace(/^["']\s*/, '').replace(/\s*["']$/, '');
        if (!Document.isFileHTTP(url) || Document.hasSameOrigin(cssUri, url)) {
            const baseDirectory = document.baseDirectory;
            let location = findRelativeUri.call(this, file, url, baseDirectory, true);
            if (location) {
                const uri = Document.resolvePath(url, cssUri);
                output = (output || content).replace(match[0], `url(${getCssUrlOrCloudUUID.call(this, file, uri ? this.findAsset(uri) : undefined, location)})`);
            }
            else if (baseDirectory && (location = Document.resolvePath(url, baseDirectory))) {
                const asset = this.findAsset(location);
                if (asset && (location = findRelativeUri.call(this, file, location, baseDirectory))) {
                    output = (output || content).replace(match[0], `url(${getCssUrlOrCloudUUID.call(this, file, asset, location)})`);
                }
            }
        }
        else {
            const asset = this.findAsset(url);
            if (asset) {
                const pathname = file.pathname;
                const count = pathname && pathname !== '/' && file.uri !== document.baseUrl ? pathname.split(/[\\/]/).length : 0;
                output = (output || content).replace(match[0], `url(${getCssUrlOrCloudUUID.call(this, file, asset, (count ? '../'.repeat(count) : '') + asset.relativeUri)})`);
            }
        }
    }
    return output;
}

function hasAttribute(data: StandardMap, value: string) {
    for (const key in data) {
        if (key.toLowerCase() === value) {
            return true;
        }
    }
    return false;
}

function deleteAttribute(data: StandardMap, ...values: string[]) {
    for (const key in data) {
        if (values.includes(key.toLowerCase())) {
            delete data[key];
        }
    }
}

function parseAttributes(tagName: string, outerHTML: string, data: StandardMap) {
    const [opening] = findClosingTag(tagName, outerHTML);
    const hasValue = (attr: string) => !attr.startsWith('data-chrome-') && !hasAttribute(data, attr = attr.toLowerCase());
    let tag = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]*))/g,
        source = opening,
        match: Null<RegExpExecArray>;
    while (match = tag.exec(opening)) {
        if (hasValue(match[1])) {
            data[match[1]] = (match[2] || match[3] || match[4]).replace(/"/g, '&quot;');
        }
        source = source.replace(match[0], '');
    }
    tag = /(<\s*|\s+)([^\s"'=/>]+)/g;
    while (match = tag.exec(source)) {
        if (match[1][0] === '<' && tagName.toUpperCase() === match[2].toUpperCase()) {
            continue;
        }
        else if (hasValue(match[2])) {
            data[match[2]] = null;
        }
    }
    return opening;
}

function writeAttributes(data: StandardMap) {
    let result = '';
    for (const key in data) {
        const value = data[key];
        if (value !== undefined) {
            result += formatAttr(key, value);
        }
    }
    return result;
}

function getTagName(tagName: string, outerHTML: string) {
    let match: Null<RegExpExecArray>;
    if (tagName) {
        match = new RegExp(`^<\\s*(${escapeRegexp(tagName)})`, 'i').exec(outerHTML);
        if (match) {
            return match[1];
        }
    }
    match = /^<\s*([^\s/>]+)/i.exec(outerHTML);
    return match ? match[1] : '';
}

const formatAttr = (key: string, value: Null<string>) => ' ' + key + (value !== null ? `="${value}"` : '');
const getNewlineString = (leading: string, trailing: string) => leading.includes('\n') || /(?:\r?\n){2,}$/.test(trailing) ? (leading + trailing).includes('\r') ? '\r\n' : '\n' : '';
const escapePosix = (value: string) => value.split(/[\\/]/).map(seg => escapeRegexp(seg)).join('[\\\\/]');
const isObject = (value: unknown): value is PlainObject => typeof value === 'object' && value !== null;

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
        const baseDirectory = instance.baseDirectory;
        switch (mimeType) {
            case '@text/html': {
                const cloud = this.Cloud;
                const baseUri = file.uri!;
                let source = this.getUTF8String(file, localUri),
                    current = '',
                    database: Undef<CloudDatabase[]>,
                    match: Null<RegExpExecArray>;
                const replaceMap: ObjectMap<number[]> = {};
                const minifySpace = (value: string) => value.replace(/[\s/]+/g, '');
                const escapeSpace = (value: string, attribute?: boolean) => attribute ? value.replace(/\s+/g, '\\s+') : value;
                const replaceIndex = (outerHTML: string, replaceWith: string, outerIndex: number, attribute?: boolean) => {
                    current = source;
                    const otherHTML = outerHTML.replace(/"\s*>$/, '" />');
                    let pattern = otherHTML !== outerHTML ? `(?:${escapeSpace(escapeRegexp(outerHTML), attribute)}|${escapeSpace(escapeRegexp(otherHTML), attribute)})` : escapeSpace(escapeRegexp(outerHTML), attribute);
                    if (outerIndex > 0 || !replaceWith) {
                        if (replaceMap[outerHTML]) {
                            outerIndex -= replaceMap[outerHTML].filter(value => value < outerIndex).length;
                        }
                        if (!replaceWith) {
                            pattern = '(\\s*)' + pattern + '[ \\t]*((?:\\r?\\n)*)';
                        }
                        const tag = new RegExp(pattern, 'g');
                        let i = 0;
                        while (match = tag.exec(source)) {
                            if (i++ === outerIndex) {
                                if (!replaceWith) {
                                    replaceWith = getNewlineString(match[1], match[2]);
                                }
                                source = source.substring(0, match.index) + replaceWith + source.substring(match.index + match[0].length);
                                (replaceMap[outerHTML] ||= []).push(outerIndex);
                                return true;
                            }
                        }
                    }
                    else {
                        source = source.replace(new RegExp(pattern), replaceWith);
                        if (current !== source) {
                            if (outerIndex !== -1) {
                                (replaceMap[outerHTML] ||= []).push(outerIndex);
                            }
                            return true;
                        }
                    }
                    return false;
                };
                const replaceMinify = (tagName: string, outerHTML: string, replaceWith: string, content?: string) => {
                    if (tagName = getTagName(tagName, outerHTML)) {
                        const openTag: number[] = [];
                        let tag = new RegExp(`<\\s*${escapeRegexp(tagName)}\\b`, 'ig');
                        while (match = tag.exec(source)) {
                            openTag.push(match.index);
                        }
                        const open = openTag.length;
                        if (open) {
                            const closeTag: number[] = [];
                            tag = new RegExp(`</\\s*${escapeRegexp(tagName)}\\s*>`, 'ig');
                            while (match = tag.exec(source)) {
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
                                        const outerText = source.substring(openTag[i], closeTag[j]);
                                        if (outerHTML === minifySpace(outerText) || content && content === minifySpace(findClosingTag(tagName, outerText)[2])) {
                                            let leading = '',
                                                trailing = '',
                                                k = closeTag[j];
                                            newline: {
                                                let found: Undef<boolean>;
                                                while (isSpace(source[k])) {
                                                    const ch = source[k++];
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
                                            if (!replaceWith) {
                                                k = openTag[i] - 1;
                                                while (isSpace(source[k])) {
                                                    leading = source[k--] + leading;
                                                }
                                                source = source.replace(leading + outerText + trailing, getNewlineString(leading, trailing));
                                            }
                                            else {
                                                source = source.replace(outerText, replaceWith);
                                            }
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        if (current !== source) {
                            return true;
                        }
                    }
                    return false;
                };
                const setOuterIndex = (replaceWith: string, tagName: string, tagIndex: number, target?: DocumentAsset) => {
                    for (const { element } of (this.assets as ElementAction[]).concat(database || [])) {
                        if (element && element.tagName === tagName && element.tagIndex === tagIndex) {
                            element.outerHTML = replaceWith;
                        }
                    }
                    const related = this.assets.filter((item: DocumentAsset) => item === target || item.element && item.element.outerHTML === replaceWith).map((other: DocumentAsset) => other.element!);
                    if (database) {
                        related.push(...database.filter(item => item.element!.outerHTML === replaceWith).map(other => other.element!));
                    }
                    if (related.length) {
                        const location: ElementIndex[][] = [];
                        for (const other of related) {
                            (location[other.tagIndex] ||= []).push(other);
                        }
                        location.filter(item => item).forEach((item, index) => item.forEach(other => other.outerIndex = index));
                        delete replaceMap[replaceWith];
                    }
                    else if (target) {
                        target.element!.outerIndex = -1;
                    }
                };
                if (cloud && cloud.database) {
                    const cacheKey = uuid.v4();
                    database = cloud.database.filter(item => this.hasDocument(instance, item.document) && item.element);
                    const pattern = /\$\{\s*(\w+)\s*\}/g;
                    (await Promise.all(
                        database.map(item => {
                            return cloud.getDatabaseRows(item, cacheKey).catch(err => {
                                if (err instanceof Error && err.message) {
                                    this.errors.push(err.message);
                                }
                                return [];
                            });
                        })
                    )).forEach((result, index) => {
                        if (result.length) {
                            const item = database![index];
                            const { tagName, tagIndex, outerHTML, outerIndex } = item.element!;
                            const template = item.value;
                            let replaceWith: Undef<string>;
                            if (typeof template === 'string') {
                                const [opening, closing] = findClosingTag(tagName, outerHTML, false);
                                if (opening && closing) {
                                    let output = '';
                                    for (const row of result) {
                                        let value = template;
                                        while (match = pattern.exec(template)) {
                                            value = value.replace(match[0], getObjectValue(row, match[1]));
                                        }
                                        output += value;
                                        pattern.lastIndex = 0;
                                    }
                                    replaceWith = opening + output + closing;
                                }
                            }
                            else {
                                const [opening] = findClosingTag(tagName, outerHTML);
                                let replacing = opening;
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
                                            match = new RegExp(`\\s*${attr}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'i').exec(replacing);
                                            replacing = match ? replacing.replace(match[0], formatAttr(attr, value)) : replacing.replace(new RegExp(`^<\\s*(${escapeRegexp(tagName)})(\\s*)`, 'i'), (...capture) => '<' + capture[1] + formatAttr(attr, value) + (capture[2] ? ' ' : ''));
                                            break;
                                        }
                                    }
                                }
                                if (replacing !== opening) {
                                    replaceWith = replacing + (opening !== outerHTML ? outerHTML.substring(opening.length) : '');
                                }
                            }
                            if (replaceWith && (replaceIndex(outerHTML, replaceWith, outerIndex) || replaceMinify(tagName, outerHTML, replaceWith))) {
                                setOuterIndex(replaceWith, tagName, tagIndex);
                            }
                        }
                        else {
                            const { service, table, id, query } = database![index];
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
                for (const item of this.assets as DocumentAsset[]) {
                    if (item.invalid && !item.exclude && item.bundleIndex === undefined) {
                        continue;
                    }
                    const { trailingContent, element } = item;
                    if (trailingContent) {
                        const pattern = /(\s*)<\s*(script|style)\b[\S\s]+?<\/\s*\2\s*>[ \t]*((?:\r?\n)*)/ig;
                        const value = trailingContent.map(content => minifySpace(content));
                        current = source;
                        while (match = pattern.exec(current)) {
                            const content = findClosingTag(match[2].toUpperCase(), match[0].trim())[2];
                            if (content && value.includes(minifySpace(content))) {
                                source = source.replace(match[0], getNewlineString(match[1], match[3]));
                            }
                        }
                        pattern.lastIndex = 0;
                    }
                    if (element) {
                        const { content, bundleIndex, inlineContent, attributes = {} } = item;
                        const { tagName, outerHTML, outerIndex } = element;
                        if (inlineContent) {
                            const id = `<!-- ${uuid.v4()} -->`;
                            parseAttributes(tagName, outerHTML, attributes);
                            deleteAttribute(attributes, 'src', 'href');
                            const replaceWith = `<${inlineContent + writeAttributes(attributes)}>${id}</${inlineContent}>`;
                            if (replaceIndex(outerHTML, replaceWith, outerIndex) || replaceMinify('', outerHTML, replaceWith, content)) {
                                item.inlineContent = id;
                                item.watch = false;
                                element.outerHTML = replaceWith;
                                element.outerIndex = -1;
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
                                value = item.relativeUri!;
                            }
                            let replaceWith: string;
                            if (tagName === 'LINK' || tagName === 'STYLE') {
                                if (!hasAttribute(attributes, 'rel')) {
                                    attributes.rel = 'stylesheet';
                                }
                                parseAttributes(tagName, outerHTML, attributes);
                                deleteAttribute(attributes, 'href');
                                replaceWith = `<link${writeAttributes(attributes)} href="${value}" />`;
                            }
                            else {
                                parseAttributes(tagName, outerHTML, attributes);
                                deleteAttribute(attributes, 'src');
                                replaceWith = `<script${writeAttributes(attributes)} src="${value}"></script>`;
                            }
                            if (!replaceIndex(outerHTML, replaceWith, outerIndex) && !replaceMinify('', outerHTML, replaceWith, content)) {
                                delete item.inlineCloud;
                            }
                            continue;
                        }
                        else if (item.exclude || bundleIndex !== undefined) {
                            if (!replaceIndex(outerHTML, '', outerIndex)) {
                                replaceMinify(tagName, outerHTML, '', content);
                            }
                            continue;
                        }
                        if (Object.keys(attributes).length) {
                            const opening = parseAttributes(tagName, outerHTML, attributes);
                            let replaceWith = '<' + (getTagName(tagName, outerHTML) || tagName) + writeAttributes(attributes);
                            if (opening === outerHTML) {
                                switch (tagName) {
                                    case 'HTML':
                                        replaceWith += '>';
                                        break;
                                    default:
                                        replaceWith += ' />';
                                        break;
                                }
                            }
                            else {
                                replaceWith += outerHTML.substring(opening.length);
                            }
                            if (replaceIndex(outerHTML, replaceWith, outerIndex) || replaceMinify(tagName, outerHTML, replaceWith, content)) {
                                setOuterIndex(replaceWith, tagName, element.tagIndex, item);
                            }
                        }
                    }
                }
                for (const item of this.assets as DocumentAsset[]) {
                    if (item === file || item.content || item.bundleIndex !== undefined || item.inlineContent || !item.uri || item.invalid) {
                        continue;
                    }
                    if (item.element) {
                        const { uri, element } = item;
                        const { outerHTML, outerIndex } = element;
                        const sameOrigin = Document.hasSameOrigin(baseUri, uri);
                        const src = [uri];
                        let base64 = false,
                            value: Undef<string>;
                        if (item.mimeType?.startsWith('image/')) {
                            switch (item.format) {
                                case 'base64':
                                    value = uuid.v4();
                                    item.inlineBase64 = value;
                                    item.watch = false;
                                    break;
                                case 'blob': {
                                    const url = getElementSrc(outerHTML);
                                    if (url) {
                                        src[0] = url;
                                        base64 = true;
                                    }
                                    break;
                                }
                            }
                        }
                        if (sameOrigin && !base64) {
                            let url = getElementSrc(outerHTML);
                            if (url && uri === Document.resolvePath(url, baseUri)) {
                                src.push(url);
                            }
                            url = uri.startsWith(baseDirectory) ? uri.substring(baseDirectory.length) : uri.replace(new URL(baseUri).origin, '');
                            if (!src.includes(url)) {
                                src.push(url);
                            }
                        }
                        if (cloud && cloud.getStorage('upload', item.cloudStorage) && !item.inlineBase64) {
                            value = uuid.v4();
                            item.inlineCloud = value;
                        }
                        const opening = outerHTML.replace(/\s*\/?\s*>([\S\s]*<\/[^>]+>)?$/, '');
                        const replaced = replaceSrc(opening, src, value || item.relativeUri!, base64, sameOrigin ? [baseUri, uri] : undefined);
                        if (replaced) {
                            const replaceWith = outerHTML.replace(opening, replaced);
                            if (replaceIndex(outerHTML, replaceWith, outerIndex) || replaceIndex(outerHTML, replaceWith, outerIndex, true) || replaceMinify(element.tagName, outerHTML, replaceWith)) {
                                setOuterIndex(replaceWith, element.tagName, element.tagIndex, item);
                                continue;
                            }
                        }
                        delete item.inlineCloud;
                        delete item.inlineBase64;
                    }
                    else if (item.base64) {
                        let value = item.relativeUri!;
                        if (cloud && cloud.getStorage('upload', item.cloudStorage)) {
                            value = uuid.v4();
                            item.inlineCloud = value;
                        }
                        const result = replaceUrl(source, item.base64, value, true);
                        if (result) {
                            source = result;
                        }
                        else {
                            delete item.inlineCloud;
                        }
                    }
                }
                file.sourceUTF8 = removeFileCommands(transformCss.call(this, instance, file, source) || source);
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
        const inlineMap: StringMap = {};
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
        async function replaceContent(manager: IFileManager, file: DocumentAsset, source: string, content?: boolean, formatting?: boolean) {
            if (file.mimeType![0] === '@') {
                if (content) {
                    let current = source;
                    for (const item of srcSet) {
                        const element = item.element;
                        if (element) {
                            let outerHTML = element.outerHTML,
                                value = 'srcset="',
                                start = true,
                                match = /(\s*)srcset\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(outerHTML);
                            if (match) {
                                value = (match[2] || match[3]).trim();
                                start = false;
                            }
                            const images = item.srcSet!;
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
                            else if (match = /^(<\s*[\w-]+)(\s*)/.exec(outerHTML)) {
                                outerHTML = outerHTML.replace(match[0], match[1] + ' ' + value + (match[2] ? ' ' : ''));
                            }
                            else {
                                continue;
                            }
                            source = source.replace(element.outerHTML, outerHTML);
                            if (current !== source) {
                                element.outerHTML = outerHTML;
                                current = source;
                            }
                        }
                    }
                }
                for (const id in base64Map) {
                    source = source.replace(new RegExp(id, 'g'), base64Map[id]!);
                }
                for (const asset of replaced) {
                    source = source.replace(new RegExp(escapePosix(manager.getRelativeUri(asset, asset.originalName)), 'g'), asset.relativeUri!);
                }
                if (instance.productionRelease) {
                    source = source.replace(new RegExp('(\\.\\./)*' + instance.internalServerRoot, 'g'), '');
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
                    let content: Undef<boolean>,
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
                            content = true;
                        case '@text/css':
                            if (item.sourceUTF8 || item.buffer) {
                                tasks.push(replaceContent(this, item, this.getUTF8String(item), content, formatting));
                            }
                            else {
                                tasks.push(fs.readFile(item.localUri!, 'utf8').then(data => replaceContent(this, item, data, content, formatting)));
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
            for (const item of assets) {
                const inlineContent = item.inlineContent;
                if (inlineContent && inlineContent.startsWith('<!--')) {
                    inlineMap[inlineContent] = this.getUTF8String(item).trim();
                    removeFile(item);
                }
            }
            if (Object.keys(inlineMap).length) {
                for (const item of instance.htmlFiles) {
                    let content = this.getUTF8String(item);
                    for (const id in inlineMap) {
                        content = content.replace(id, inlineMap[id]!);
                    }
                    item.sourceUTF8 = content;
                }
            }
        }
    }

    public htmlFiles: DocumentAsset[] = [];
    public cssFiles: DocumentAsset[] = [];
    public baseDirectory = '';
    public internalServerRoot = '__serverroot__';
    public unusedStyles?: string[];
    public baseUrl?: string;
    public readonly moduleName = 'chrome';

    private _cloudMap!: ObjectMap<DocumentAsset>;
    private _cloudCssMap!: ObjectMap<DocumentAsset>;
    private _cloudModifiedHtml!: boolean;
    private _cloudEndpoint!: string;
    private _cloudModifiedCss: Undef<Set<DocumentAsset>>;

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
            const result = transformCss.call(manager, this, file, content);
            if (result) {
                content = result;
            }
        }
        return content;
    }
    imageQueue(data: FileData, saveAs: string, command: string) {
        const localUri = data.file.localUri;
        if (localUri) {
            const match = REGEXP_SRCSETSIZE.exec(command);
            if (match) {
                return Document.renameExt(localUri, match[1] + match[2].toLowerCase() + '.' + saveAs);
            }
        }
    }
    imageFinalize(err: Null<Error>, data: OutputData) {
        const { file, output } = data;
        if (!err && output) {
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
        this._cloudModifiedHtml = false;
        this._cloudModifiedCss = undefined;
        this._cloudEndpoint = '';
        if (this.htmlFiles.length === 1) {
            const upload = state.instance.getStorage('upload', this.htmlFiles[0].cloudStorage)?.upload;
            if (upload && upload.endpoint) {
                this._cloudEndpoint = Document.toPosix(upload.endpoint) + '/';
            }
        }
    }
    cloudObject(state: CloudIScopeOrigin, file: DocumentAsset) {
        if (file.inlineCloud) {
            this._cloudMap[file.inlineCloud] = file;
            this._cloudModifiedHtml = true;
        }
        else if (file.inlineCssCloud) {
            this._cloudCssMap[file.inlineCssCloud] = file;
            this._cloudModifiedCss = new Set();
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
                for (const content of this.htmlFiles) {
                    content.sourceUTF8 = host.getUTF8String(content).replace(file.inlineCloud, cloudUrl);
                    delete this._cloudMap[file.inlineCloud];
                }
            }
            else if (file.inlineCssCloud) {
                const pattern = new RegExp(file.inlineCssCloud, 'g');
                for (const content of this.htmlFiles) {
                    content.sourceUTF8 = host.getUTF8String(content).replace(pattern, cloudUrl);
                }
                if (endpoint && cloudUrl.indexOf('/') !== -1) {
                    cloudUrl = url;
                }
                for (const content of this.cssFiles) {
                    if (content.inlineCssMap) {
                        content.sourceUTF8 = host.getUTF8String(content).replace(pattern, cloudUrl);
                        this._cloudModifiedCss!.add(content);
                    }
                }
                delete this._cloudCssMap[file.inlineCssCloud];
            }
            file.cloudUrl = cloudUrl;
        }
        return false;
    }
    async cloudFinalize(state: CloudIScopeOrigin) {
        const { host, localStorage, compressed } = state;
        const modifiedCss = this._cloudModifiedCss;
        let tasks: Promise<unknown>[] = [];
        if (modifiedCss) {
            const cloudCssMap = this._cloudCssMap;
            for (const id in cloudCssMap) {
                for (const item of this.cssFiles) {
                    const inlineCssMap = item.inlineCssMap;
                    if (inlineCssMap && inlineCssMap[id]) {
                        item.sourceUTF8 = host.getUTF8String(item).replace(new RegExp(id, 'g'), inlineCssMap[id]!);
                        modifiedCss.add(item);
                    }
                }
                localStorage.delete(cloudCssMap[id]);
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
        if (this._cloudModifiedHtml) {
            const cloudMap = this._cloudMap;
            for (const item of this.htmlFiles) {
                let sourceUTF8 = host.getUTF8String(item);
                for (const id in cloudMap) {
                    const file = cloudMap[id];
                    sourceUTF8 = sourceUTF8.replace(id, file.relativeUri!);
                    localStorage.delete(file);
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