import type { IFileManager } from '../../types/lib';
import type { FileData } from '../../types/lib/asset';
import type { OutputData } from '../../types/lib/image';
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

const REGEXP_TAGSTART = /^(\s*<\s*[\w-]+)(\s*)/;
const REGEXP_SRCSETSIZE = /~\s*([\d.]+)\s*([wx])/i;

function removeFileCommands(value: string) {
    return value
        .replace(/\s*<(script|link|style).+?data-chrome-file="exclude"[\s\S]*?<\/\1>\n*/g, '')
        .replace(/\s*<(script|link).+?data-chrome-file="exclude"[^>]*>\n*/g, '')
        .replace(/\s*<script.+?data-chrome-template="([^"]|(?<=\\)")*"[\s\S]*?<\/script>\n*/g, '')
        .replace(/\s+data-(use|chrome-[\w-]+)="([^"]|(?<=\\)")*"/g, '');
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

function findClosingTag(outerHTML: string): [string, string, string] {
    const forward = outerHTML.split('>');
    const opposing = outerHTML.split('<');
    if (opposing.length === 1 || forward.length === 1) {
        const match = /^(\s*)<([\w-]+)(.*?)\/?>(\s*)$/.exec(outerHTML);
        if (match) {
            return [match[1] + '<' + match[2] + match[3] + '>', `</${match[2]}>` + match[4], ''];
        }
    }
    else if (opposing.length === 2 && forward.length === 2 && /^\s*<([\w-]+)[^>]*>[\S\s]*?<\/\1>\s*$/.test(outerHTML)) {
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
        if (item.base64 && !item.outerHTML && item.uri && Document.hasSameOrigin(cssUri, item.uri)) {
            const url = findRelativeUri.call(this, file, item.uri, document.baseDirectory);
            if (url) {
                const replaced = replaceUri(output || content, [item.base64.replace(/\+/g, '\\+')], getCssUrlOrCloudUUID.call(this, file, item, url), false, true);
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

const escapePosix = (value: string) => value.replace(/[\\/]/g, '[\\\\/]');
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
                let html = this.getUTF8String(file, localUri),
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
                    const pattern = /\$\{\s*(\w+)\s*\}/g;
                    (await Promise.all(
                        items.map(item => {
                            return cloud.getDatabaseRows(item, cacheKey).catch(err => {
                                if (err instanceof Error && err.message) {
                                    this.errors.push(err.toString());
                                }
                                return [];
                            });
                        })
                    )).forEach((result, index) => {
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
                                    for (const asset of this.assets as DocumentAsset[]) {
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
                            this.formatMessage(this.logType.CLOUD_DATABASE, service, ['Query had no results', table ? 'table: ' + table : ''], queryString, { titleColor: 'yellow' });
                        }
                    });
                }
                const baseUri = file.uri!;
                const pattern = /(\s*)<(script|style)[^>]*>([\s\S]*?)<\/\2>\n*/g;
                for (const item of this.assets as DocumentAsset[]) {
                    if (item.invalid && !item.exclude && item.bundleIndex === undefined) {
                        continue;
                    }
                    const { outerHTML, trailingContent } = item;
                    if (trailingContent) {
                        const content = trailingContent.map(value => minifySpace(value));
                        while (match = pattern.exec(html)) {
                            if (content.includes(minifySpace(match[3]))) {
                                source = source.replace(match[0], '');
                            }
                        }
                        pattern.lastIndex = 0;
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
                                value = item.relativeUri!;
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
                for (const item of this.assets as DocumentAsset[]) {
                    if (item === file || item.content || item.bundleIndex !== undefined || item.inlineContent || !item.uri || item.invalid) {
                        continue;
                    }
                    found: {
                        const { uri, outerHTML } = item;
                        current = source;
                        if (outerHTML) {
                            const segments = [uri];
                            let value = item.relativeUri!,
                                relativeUri: Undef<string>,
                                ascending: Undef<boolean>;
                            if (baseDirectory) {
                                relativeUri = uri.replace(baseDirectory, '');
                                if (relativeUri === uri) {
                                    relativeUri = '';
                                }
                            }
                            if (!relativeUri && Document.hasSameOrigin(baseUri, uri)) {
                                relativeUri = path.join(item.pathname, path.basename(uri));
                                ascending = true;
                            }
                            if (relativeUri) {
                                segments.push(relativeUri);
                            }
                            if (cloud && cloud.getStorage('upload', item.cloudStorage)) {
                                value = uuid.v4();
                                item.inlineCloud = value;
                            }
                            else if (item.mimeType?.startsWith('image/') && item.format === 'base64') {
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
                            if (relativeUri) {
                                const directory = new RegExp(`(["'\\s,=])(${(ascending ? '(?:(?:\\.\\.)?(?:[\\\\/]\\.\\.|\\.\\.[\\\\/]|[\\\\/])*)?' : '') + escapePosix(relativeUri)})`, 'g');
                                while (match = directory.exec(html)) {
                                    if (uri === Document.resolvePath(match[2], baseUri)) {
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
                            let value = item.relativeUri!;
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
                    const sourceMap = Document.createSourceMap(source, file);
                    const result = await instance.transform('css', source, format, { sourceMap });
                    if (result) {
                        source = sourceMap.output.size && sourceMap.code === result.code ? Document.writeSourceMap(localUri!, sourceMap, this) : result.code;
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
                    const sourceMap = Document.createSourceMap(source, file);
                    const result = await instance.transform('js', source, format, { sourceMap });
                    if (result) {
                        source = sourceMap.output.size && sourceMap.code === result.code ? Document.writeSourceMap(localUri!, sourceMap, this) : result.code;
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
                        let outerHTML = item.outerHTML!,
                            value = 'srcset="',
                            start = true,
                            match = /(\s*)srcset="([^"]|(?<=\\)")"/i.exec(outerHTML);
                        if (match) {
                            value = match[2].trim();
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
                        else if (match = REGEXP_TAGSTART.exec(outerHTML)) {
                            outerHTML = outerHTML.replace(match[0], match[1] + ' ' + value + (match[2] ? ' ' : ''));
                        }
                        else {
                            continue;
                        }
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
    imageQueue(data: FileData, outputType: string, saveAs: string, command: string) {
        const match = REGEXP_SRCSETSIZE.exec(command);
        if (match) {
            return Document.renameExt(data.file.localUri!, match[1] + match[2].toLowerCase() + '.' + saveAs);
        }
    }
    imageFinalize(err: Null<Error>, data: OutputData) {
        const { file, output } = data;
        if (!err && output) {
            const match = (file as DocumentAsset).outerHTML && REGEXP_SRCSETSIZE.exec(data.command);
            if (match) {
                ((file as DocumentAsset).srcSet ||= []).push(Document.toPosix(data.baseDirectory ? output.substring(data.baseDirectory.length + 1) : output), match[1] + match[2].toLowerCase());
                return true;
            }
        }
        return false;
    }
    cloudInit(state: CloudScopeOrigin) {
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
    cloudObject(state: CloudScopeOrigin, file: DocumentAsset) {
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
    async cloudUpload(state: CloudScopeOrigin, file: DocumentAsset, url: string, active: boolean) {
        if (active) {
            const host = state.host;
            const endpoint = this._cloudEndpoint;
            let cloudUri = url;
            if (endpoint) {
                cloudUri = cloudUri.replace(new RegExp(escapeRegexp(endpoint), 'g'), '');
            }
            if (file.inlineCloud) {
                for (const content of this.htmlFiles) {
                    content.sourceUTF8 = host.getUTF8String(content).replace(file.inlineCloud, cloudUri);
                    delete this._cloudMap[file.inlineCloud];
                }
            }
            else if (file.inlineCssCloud) {
                const pattern = new RegExp(file.inlineCssCloud, 'g');
                for (const content of this.htmlFiles) {
                    content.sourceUTF8 = host.getUTF8String(content).replace(pattern, cloudUri);
                }
                if (endpoint && cloudUri.indexOf('/') !== -1) {
                    cloudUri = url;
                }
                for (const content of this.cssFiles) {
                    if (content.inlineCssMap) {
                        content.sourceUTF8 = host.getUTF8String(content).replace(pattern, cloudUri);
                        this._cloudModifiedCss!.add(content);
                    }
                }
                delete this._cloudCssMap[file.inlineCssCloud];
            }
            file.cloudUri = cloudUri;
        }
        return false;
    }
    async cloudFinalize(state: CloudScopeOrigin) {
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