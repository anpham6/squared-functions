import type { ElementAction, ElementIndex } from '../../types/lib/squared';

import type { IFileManager } from '../../types/lib';
import type { FileData, OutputData } from '../../types/lib/asset';
import type { CloudDatabase } from '../../types/lib/cloud';
import type { SourceMapOutput } from '../../types/lib/document';
import type { DocumentModule } from '../../types/lib/module';
import type { RequestBody } from '../../types/lib/node';

import type { CloudIScopeOrigin } from '../../cloud';
import type { DocumentAsset, IChromeDocument } from './document';

import path = require('path');
import fs = require('fs-extra');
import escapeRegexp = require('escape-string-regexp');
import uuid = require('uuid');

import htmlparser2 = require('htmlparser2');
import domhandler = require('domhandler');
import domutils = require('domutils');

import Document from '../../document';
import Cloud from '../../cloud';

const Parser = htmlparser2.Parser;
const DomHandler = domhandler.DomHandler;

const REGEXP_SRCSETSIZE = /~\s*([\d.]+)\s*([wx])/i;

function removeFileCommands(value: string) {
    if (value.includes('data-chrome')) {
        return value
            .replace(/(\s*)<(script|link|style).+?data-chrome-file\s*=\s*(["'])?exclude\3[\S\s]*?<\/\s*\2\s*>[ \t]*((?:\r?\n)*)/ig, (...capture) => getNewlineString(capture[1], capture[4]))
            .replace(/(\s*)<(?:script|link).+?data-chrome-file\s*=\s*(["'])?exclude\2[^>]*>[ \t]*((?:\r?\n)*)/ig, (...capture) => getNewlineString(capture[1], capture[3]))
            .replace(/(\s*)<script.+?data-chrome-template\s*=\s*(?:"[^"]*"|'[^']*')[\S\s]*?<\/\s*script\s*>[ \t]*((?:\r?\n)*)/ig, (...capture) => getNewlineString(capture[1], capture[2]))
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

function findClosingTag(tagName: string, outerHTML: string, startIndex = -1, closed = true): [string, string, string] {
    const forward = outerHTML.split('>');
    const opposing = outerHTML.split('<');
    if (startIndex === -1) {
        if (opposing.length === 1 || forward.length === 1) {
            if (!closed) {
                switch (tagName) {
                    case 'HTML':
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
                        const match = /^<([^\s/>]+)(.*?)\/?>$/.exec(outerHTML);
                        if (match) {
                            return ['<' + match[1] + match[2] + '>', `</${match[1]}>`, ''];
                        }
                    }
                    break;
                }
            }
            return [outerHTML, '', ''];
        }
        else if (opposing.length === 2 && forward.length === 2 && /^<[^>]+>[\S\s]*?<\/[^>]+>$/i.test(outerHTML)) {
            return [forward[0] + '>', '<' + opposing[1], forward[1] + opposing[0]];
        }
    }
    const openIndex = startIndex === -1 ? 0 : startIndex;
    const length = outerHTML.length;
    const start: number[] = [];
    let opening: Undef<string>;
    for (let i = openIndex, quote = ''; i < length; ++i) {
        const ch = outerHTML[i];
        if (ch === '=') {
            if (!quote) {
                while (isSpace(outerHTML[++i])) {}
                switch (outerHTML[i]) {
                    case '"':
                        quote = '"';
                        start.push(i);
                        break;
                    case "'":
                        quote = "'";
                        start.push(i);
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
            opening = outerHTML.substring(openIndex, i + 1);
            break;
        }
    }
    if (!opening && start.length) {
        found: {
            for (const index of start.reverse()) {
                for (let j = index + 1; j < length; ++j) {
                    if (outerHTML[j] === '>') {
                        opening = outerHTML.substring(openIndex, j + 1);
                        break found;
                    }
                }
            }
        }
    }
    if (opening) {
        const q = opening.length;
        const index = outerHTML.lastIndexOf('<');
        if (q < index && q < length) {
            return [opening, outerHTML.substring(index), outerHTML.substring(q, index)];
        }
    }
    return [outerHTML, '', ''];
}

function replaceUrl(css: string, src: string, value: string, base64: boolean) {
    const pattern = new RegExp(`\\b[Uu][Rr][Ll]\\(\\s*(["']{0,1})\\s*${!base64 ? escapePosix(src) : `[^"',]+,\\s*` + src.replace(/\+/g, '\\+')}\\s*\\1\\s*\\)`, 'g');
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
            let replaceHTML = '';
            if (segment.trim().endsWith('{')) {
                replaceHTML = ' {' + match[2];
            }
            else if (segment[0] === ',') {
                replaceHTML = ', ';
            }
            output = (output || source).replace(match[0], match[0].replace(segment, replaceHTML));
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

function findRelativeUri(this: IFileManager, file: DocumentAsset, url: string, baseDirectory?: string, partial?: boolean) {
    const origin = file.uri!;
    let asset: Undef<DocumentAsset>;
    if (partial) {
        if (url = Document.resolvePath(url, origin)) {
            asset = this.findAsset(url);
        }
    }
    else {
        asset = this.findAsset(url);
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
    const baseDirectory = document.baseDirectory;
    const cssUri = file.uri!;
    let output: Undef<string>;
    for (const item of this.assets as DocumentAsset[]) {
        if (item.base64 && !item.element && item.uri && Document.hasSameOrigin(cssUri, item.uri)) {
            const url = findRelativeUri.call(this, file, item.uri, baseDirectory);
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
    const hasValue = (attr: string) => /^[a-z][a-z\d-:.]*$/.test(attr) && !hasAttribute(data, attr) && !attr.startsWith('data-chrome-');
    let tag = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]*))/g,
        source = opening,
        match: Null<RegExpExecArray>;
    while (match = tag.exec(opening)) {
        const attr = match[1].toLowerCase();
        if (hasValue(attr)) {
            data[attr] = match[2] || match[3] || match[4] || '';
        }
        source = source.replace(match[0], '');
    }
    tag = /(<|\s+)([^\s="'/>]+)/g;
    while (match = tag.exec(source)) {
        if (match[1][0] === '<' && tagName.toUpperCase() === match[2].toUpperCase()) {
            continue;
        }
        else {
            const attr = match[2].toLowerCase();
            if (hasValue(attr)) {
                data[attr] = null;
            }
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
        match = new RegExp(`^<(${escapeRegexp(tagName)})`, 'i').exec(outerHTML);
        if (match) {
            return match[1];
        }
    }
    match = /^<([^\s/>]+)/i.exec(outerHTML);
    return match ? match[1] : '';
}

const formatAttr = (key: string, value: Null<string>) => ' ' + key + (value !== null ? `="${value.replace(/"/g, '&quot;')}"` : '');
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
        switch (mimeType) {
            case '@text/html': {
                this.formatMessage(this.logType.PROCESS, 'HTML', ['Rewriting content...', path.basename(localUri!)]);
                const time = Date.now();
                const cloud = this.Cloud;
                const baseDirectory = instance.baseDirectory;
                const baseUri = file.uri!;
                const parserOptions: domhandler.DomHandlerOptions = { withStartIndices: true, withEndIndices: true };
                let source = this.getUTF8String(file, localUri),
                    replaceCount = 0,
                    database: Undef<CloudDatabase[]>,
                    elementIndex: Undef<ElementIndex[]>,
                    match: Null<RegExpExecArray>;
                const minifySpace = (value: string) => value.replace(/[\s/]+/g, '');
                const isRemoved = (item: DocumentAsset) => item.exclude || item.bundleIndex !== undefined;
                const spliceSource = (replaceHTML: string, index: [number, number, string?]) => source = source.substring(0, index[0]) + replaceHTML + source.substring(index[1]);
                const getErrorDOM = (tagName: string, tagIndex: number) => new Error(`${tagName} ${tagIndex}: Unable to parse DOM`);
                const getIndexItems = () => elementIndex ||= (this.assets as ElementAction[]).concat(database || []).filter(item => item.element).map(item => item.element!);
                const writeFailDOM = (err?: Error) => {
                    if (err) {
                        this.writeFail(['Unable to rebuild DOM', 'htmlparser2'], err);
                    }
                    else {
                        this.writeFail('Unknown', new Error('htmlparser2: Unable to rebuild DOM'));
                    }
                };
                const replaceIndex = (outerIndex: number, outerCount: number, outerHTML: string, replaceHTML: string) => {
                    const otherHTML = outerHTML.replace(/"\s*>$/, '" />');
                    let pattern = otherHTML !== outerHTML ? `(?:${escapeRegexp(outerHTML)}|${escapeRegexp(otherHTML)})` : escapeRegexp(outerHTML);
                    if (outerCount > 1 || !replaceHTML) {
                        if (!replaceHTML) {
                            pattern = '(\\s*)' + pattern + '[ \\t]*((?:\\r?\\n)*)';
                        }
                        const foundIndex: [number, number, string][] = [];
                        const tag = new RegExp(pattern, 'g');
                        while (match = tag.exec(source)) {
                            foundIndex.push([match.index, match.index + match[0].length, !replaceHTML ? getNewlineString(match[1], match[2]) : '']);
                        }
                        if (foundIndex.length === outerCount) {
                            spliceSource(replaceHTML, foundIndex[outerIndex]);
                            ++replaceCount;
                            return true;
                        }
                    }
                    else if (outerCount === 1) {
                        const current = source;
                        source = source.replace(new RegExp(pattern), replaceHTML);
                        if (current !== source) {
                            ++replaceCount;
                            return true;
                        }
                    }
                    return false;
                };
                const rebuildIndex = (tagName: string, tagIndex: number, outerIndex: number, outerCount: number, outerHTML: string, replaceHTML: string, target: Null<ElementIndex>, domData?: { nodes: domhandler.Element[]; sourceIndex: number }) => {
                    if (tagName === 'HTML') {
                        return;
                    }
                    const elements: ElementIndex[] = [];
                    const related: ElementIndex[] = [];
                    const failAll = (nodes: ElementIndex[]) => {
                        for (const item of nodes) {
                            item.outerIndex = -1;
                            item.outerCount = 0;
                        }
                    };
                    for (const element of getIndexItems()) {
                        if (element.tagName === tagName) {
                            if (element.tagIndex === tagIndex) {
                                element.outerHTML = replaceHTML;
                                related.push(element);
                            }
                            elements.push(element);
                        }
                    }
                    if (domData) {
                        const previous = elements.filter(item => item.outerHTML === outerHTML);
                        if (previous.length) {
                            const { nodes, sourceIndex } = domData;
                            const matched: number[] = [];
                            const length = domData.nodes.length;
                            let failed: Undef<boolean>;
                            if (length === previous[0].tagCount) {
                                for (let i = 0; i < length; ++i) {
                                    const { startIndex, endIndex } = nodes[i];
                                    if (source.substring(startIndex!, endIndex! + 1) === outerHTML) {
                                        matched.push(i);
                                    }
                                }
                            }
                            else {
                                failed = true;
                            }
                            if (matched.length === previous[0].outerCount - 1) {
                                for (const item of previous) {
                                    const index = matched.findIndex(value => value === item.tagIndex);
                                    if (index !== -1) {
                                        if (nodes[index].startIndex! >= sourceIndex) {
                                            --item.outerIndex;
                                        }
                                        --item.outerCount;
                                    }
                                    else {
                                        failed = true;
                                        break;
                                    }
                                }
                            }
                            if (failed) {
                                failAll(previous);
                            }
                        }
                    }
                    else {
                        for (const element of elements) {
                            if (element.outerCount === outerCount && element.outerHTML === outerHTML) {
                                if (element.outerIndex > outerIndex) {
                                    --element.outerIndex;
                                }
                                --element.outerCount;
                            }
                        }
                    }
                    const next = elements.filter(item => !related.includes(item) && item.outerHTML === replaceHTML);
                    if (next.length) {
                        next.push(...related);
                        new Parser(new DomHandler((err, dom) => {
                            if (!err) {
                                const tag = tagName.toLowerCase();
                                const nodes = domutils.findAll(elem => elem.tagName === tag, dom);
                                const matched: number[] = [];
                                const length = nodes.length;
                                let failed: Undef<boolean>;
                                if (length === next[0].tagCount) {
                                    for (let i = 0; i < length; ++i) {
                                        const { startIndex, endIndex } = nodes[i];
                                        if (source.substring(startIndex!, endIndex! + 1) === replaceHTML) {
                                            matched.push(i);
                                        }
                                    }
                                }
                                else {
                                    failed = true;
                                }
                                outerCount = matched.length;
                                if (outerCount) {
                                    for (const item of next) {
                                        const index = matched.findIndex(value => value === item.tagIndex);
                                        if (index !== -1) {
                                            item.outerIndex = index;
                                            item.outerCount = outerCount;
                                        }
                                        else {
                                            failed = true;
                                            break;
                                        }
                                    }
                                }
                                else {
                                    failed = true;
                                }
                                if (failed) {
                                    failAll(next);
                                }
                            }
                            else {
                                writeFailDOM(err);
                            }
                        }, parserOptions)).end(source);
                    }
                    else {
                        for (const item of related) {
                            item.outerIndex = 0;
                            item.outerCount = 1;
                        }
                    }
                };
                const decrementIndex = (tagName: string, tagIndex: number) => {
                    for (const element of getIndexItems()) {
                        if (element.tagName === tagName) {
                            if (element.tagIndex === tagIndex) {
                                element.tagIndex = -1;
                            }
                            else if (element.tagIndex > tagIndex) {
                                --element.tagIndex;
                            }
                            --element.tagCount;
                        }
                    }
                };
                const tryMinify = (tagName: string, tagIndex: number, tagCount: number, outerHTML: string, replaceHTML: string, content?: string) => {
                    let result = false;
                    const findHTML = (startIndex: number) => {
                        if (startIndex !== -1) {
                            const [open, close] = findClosingTag('HTML', source, startIndex);
                            if (open && close) {
                                spliceSource(replaceHTML, [startIndex, startIndex + open.length]);
                                ++replaceCount;
                                result = true;
                                return true;
                            }
                        }
                        return false;
                    };
                    const [opening, closing] = findClosingTag(tagName ||= getTagName(tagName, outerHTML), outerHTML);
                    const foundIndex: [number, number][] = [];
                    const minHTML = minifySpace(outerHTML);
                    let index: Undef<[number, number]>;
                    if (opening && closing) {
                        const openTag: number[] = [];
                        let tag = new RegExp(`<${escapeRegexp(tagName)}\\b`, 'ig');
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
                                        if (tagName === 'HTML') {
                                            if (findHTML(openTag[i])) {
                                                return true;
                                            }
                                            break;
                                        }
                                        else {
                                            foundIndex.push([openTag[i], closeTag[j]]);
                                        }
                                    }
                                }
                            }
                            if (foundIndex.length) {
                                if (foundIndex.length === tagCount) {
                                    const [startIndex, endIndex] = foundIndex[tagIndex];
                                    if (minHTML === minifySpace(source.substring(startIndex, endIndex))) {
                                        index = foundIndex[tagIndex];
                                    }
                                }
                                if (!index && content) {
                                    const minContent = minifySpace(content);
                                    const contentIndex: [number, number][] = [];
                                    for (const [startIndex, endIndex] of foundIndex) {
                                        if (minContent === minifySpace(findClosingTag(tagName, source.substring(startIndex, endIndex))[2])) {
                                            contentIndex.push([startIndex, endIndex]);
                                        }
                                    }
                                    if (contentIndex.length === 1) {
                                        index = contentIndex[0];
                                    }
                                }
                            }
                        }
                    }
                    if (!index) {
                        if (tagName === 'HTML') {
                            findHTML(startOfHTML());
                        }
                        else {
                            new Parser(new DomHandler((err, dom) => {
                                if (!err) {
                                    const tag = tagName.toLowerCase();
                                    const nodes = domutils.findAll(elem => elem.tagName === tag, dom);
                                    if (nodes.length === tagCount) {
                                        const { startIndex, endIndex } = nodes[tagIndex];
                                        if (minHTML === minifySpace(source.substring(startIndex!, endIndex! + 1))) {
                                            index = [startIndex!, endIndex! + 1];
                                        }
                                    }
                                }
                                else {
                                    writeFailDOM(err);
                                }
                            }, parserOptions)).end(source);
                        }
                    }
                    if (index) {
                        let leading = '',
                            trailing = '',
                            i = index[1];
                        newline: {
                            let found: Undef<boolean>;
                            while (isSpace(source[i])) {
                                const ch = source[i++];
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
                        if (!replaceHTML) {
                            i = index[0] - 1;
                            while (isSpace(source[i])) {
                                leading = source[i--] + leading;
                            }
                            replaceHTML = getNewlineString(leading, trailing);
                            index[0] -= leading.length;
                            index[1] += trailing.length;
                        }
                        spliceSource(replaceHTML, index);
                        ++replaceCount;
                        return true;
                    }
                    return result;
                };
                const startOfHTML = () => {
                    let result = -1;
                    new Parser(new DomHandler((err, dom) => {
                        if (!err) {
                            const html = domutils.findOne(elem => elem.tagName === 'html', dom);
                            if (html) {
                                result = html.startIndex!;
                            }
                            else {
                                writeFailDOM();
                            }
                        }
                        else {
                            writeFailDOM(err);
                        }
                    }, parserOptions)).end(source);
                    return result;
                };
                if (cloud && (database = cloud.database.filter(item => this.hasDocument(instance, item.document) && item.element)) && database.length) {
                    const cacheKey = uuid.v4();
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
                            const element = item.element!;
                            const { tagName, tagIndex, tagCount, outerHTML, outerIndex, outerCount } = element;
                            const template = item.value;
                            let replaceHTML: Undef<string>;
                            if (typeof template === 'string') {
                                const [opening, closing] = findClosingTag(tagName, outerHTML, -1, false);
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
                                    replaceHTML = opening + output + closing;
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
                                            replacing = match ? replacing.replace(match[0], formatAttr(attr, value)) : replacing.replace(new RegExp(`^<(${escapeRegexp(tagName)})(\\s*)`, 'i'), (...capture) => '<' + capture[1] + formatAttr(attr, value) + (capture[2] ? ' ' : ''));
                                            break;
                                        }
                                    }
                                }
                                if (replacing !== opening) {
                                    replaceHTML = replacing + (opening !== outerHTML ? outerHTML.substring(opening.length) : '');
                                }
                            }
                            if (replaceHTML && (replaceIndex(outerIndex, outerCount, outerHTML, replaceHTML) || tryMinify(tagName, tagIndex, tagCount, outerHTML, replaceHTML))) {
                                rebuildIndex(tagName, tagIndex, outerIndex, outerCount, outerHTML, replaceHTML, element);
                            }
                            else {
                                this.writeFail(['Cloud text replacement', tagName], getErrorDOM(tagName, tagIndex));
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
                for (const item of (this.assets as DocumentAsset[]).filter(asset => !(asset.invalid && !asset.exclude && asset.bundleIndex === undefined)).sort((a, b) => isRemoved(a) ? -1 : isRemoved(b) ? 1 : 0)) {
                    const element = item.element;
                    if (element) {
                        const { content, bundleIndex, inlineContent, attributes = {} } = item;
                        const { tagName, tagIndex, tagCount, outerIndex, outerCount } = element;
                        let outerHTML = element.outerHTML;
                        if (inlineContent) {
                            const id = `<!-- ${uuid.v4()} -->`;
                            parseAttributes(tagName, outerHTML, attributes);
                            deleteAttribute(attributes, 'src', 'href');
                            const replaceHTML = `<${inlineContent + writeAttributes(attributes)}>${id}</${inlineContent}>`;
                            if (replaceIndex(outerIndex, outerCount, outerHTML, replaceHTML) || tryMinify(tagName === 'LINK' ? '' : tagName, tagIndex, tagCount, outerHTML, replaceHTML, content)) {
                                if (tagName === 'LINK') {
                                    decrementIndex(tagName, tagIndex);
                                }
                                rebuildIndex(tagName, tagIndex, outerIndex, outerCount, outerHTML, replaceHTML, element);
                                item.inlineContent = id;
                                item.watch = false;
                                continue;
                            }
                            else {
                                this.writeFail(['Inline tag replacement', tagName], new Error(outerIndex + ': ' + outerHTML));
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
                            let replaceHTML: string;
                            if (tagName === 'LINK' || tagName === 'STYLE') {
                                if (!hasAttribute(attributes, 'rel')) {
                                    attributes.rel = 'stylesheet';
                                }
                                parseAttributes(tagName, outerHTML, attributes);
                                deleteAttribute(attributes, 'href');
                                replaceHTML = `<link${writeAttributes(attributes)} href="${value}" />`;
                            }
                            else {
                                parseAttributes(tagName, outerHTML, attributes);
                                deleteAttribute(attributes, 'src');
                                replaceHTML = `<script${writeAttributes(attributes)} src="${value}"></script>`;
                            }
                            if (replaceIndex(outerIndex, outerCount, outerHTML, replaceHTML) || tryMinify(tagName === 'STYLE' ? '' : tagName, tagIndex, tagCount, outerHTML, replaceHTML, content)) {
                                if (tagName === 'STYLE') {
                                    decrementIndex(tagName, tagIndex);
                                }
                                rebuildIndex(tagName, tagIndex, outerIndex, outerCount, outerHTML, replaceHTML, element);
                            }
                            else {
                                this.writeFail(['Bundle tag replacement', tagName], new Error(outerIndex + ': ' + outerHTML));
                                delete item.inlineCloud;
                            }
                            continue;
                        }
                        else if (isRemoved(item)) {
                            if (replaceIndex(outerIndex, outerCount, outerHTML, '') || tryMinify(tagName, tagIndex, tagCount, outerHTML, '', content)) {
                                decrementIndex(tagName, tagIndex);
                                rebuildIndex(tagName, tagIndex, outerIndex, outerCount, outerHTML, '', element);
                            }
                            else if (item.exclude) {
                                this.writeFail(['Excluded tag removal', tagName], new Error(outerIndex + ': ' + outerHTML));
                            }
                            continue;
                        }
                        if (Object.keys(attributes).length) {
                            if (tagName === 'HTML') {
                                const startIndex = startOfHTML();
                                if (startIndex !== -1) {
                                    const [open, close] = findClosingTag('HTML', source, startIndex);
                                    if (open && close) {
                                        outerHTML = source.substring(startIndex, startIndex + open.length);
                                        element.outerHTML = outerHTML;
                                    }
                                }
                            }
                            if (outerHTML) {
                                const opening = parseAttributes(tagName, outerHTML, attributes);
                                const replaceHTML = '<' + (getTagName(tagName, outerHTML) || tagName) + writeAttributes(attributes) + (opening === outerHTML ? opening.endsWith('/>') ? ' />' : '>' : outerHTML.substring(opening.length));
                                if (replaceIndex(outerIndex, outerCount, outerHTML, replaceHTML) || tryMinify(tagName, tagIndex, tagCount, outerHTML, replaceHTML, content)) {
                                    rebuildIndex(tagName, tagIndex, outerIndex, outerCount, outerHTML, replaceHTML, element);
                                }
                                else {
                                    this.writeFail(['Attribute replacement', tagName], new Error(outerIndex + ': ' + outerHTML));
                                }
                            }
                            else {
                                this.writeFail(`${tagName} outerHTML empty`, getErrorDOM(tagName, tagIndex));
                            }
                        }
                    }
                }
                for (const item of this.assets as DocumentAsset[]) {
                    if (item === file || item.invalid || !item.uri || item.bundleIndex !== undefined || item.content || item.inlineContent) {
                        continue;
                    }
                    const { uri, element, base64 } = item;
                    let value = item.relativeUri!;
                    if (element) {
                        const { tagName, tagIndex, tagCount, outerHTML, outerIndex, outerCount } = element;
                        const src = [uri];
                        let replaceHTML: Undef<string>;
                        new Parser(new DomHandler((err, dom) => {
                            if (!err) {
                                const outer = dom[0] as domhandler.Element;
                                const attribs = outer.attribs;
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
                                    case 'A':
                                    case 'AREA':
                                    case 'BASE':
                                    case 'LINK':
                                        attribs.href = value;
                                        break;
                                    case 'OBJECT':
                                        attribs.data = value;
                                        break;
                                    case 'VIDEO':
                                        attribs.poster = value;
                                        break;
                                    case 'IMG':
                                    case 'SOURCE': {
                                        const srcset = attribs.srcset;
                                        if (attribs.srcset) {
                                            const sameOrigin = Document.hasSameOrigin(baseUri, uri);
                                            if (sameOrigin) {
                                                let url = attribs.src;
                                                if (url && uri === Document.resolvePath(url, baseUri)) {
                                                    src.push(url);
                                                }
                                                url = uri.startsWith(baseDirectory) ? uri.substring(baseDirectory.length) : uri.replace(new URL(baseUri).origin, '');
                                                if (!src.includes(url)) {
                                                    src.push(url);
                                                }
                                            }
                                            let current = srcset;
                                            for (const url of src) {
                                                const resolve = sameOrigin && /[.\\/]/.test(url[0]);
                                                const pathname = escapePosix(url);
                                                const pattern = new RegExp(`(,?\\s*)(${(resolve && item[0] !== '.' ? '(?:\\.\\.[\\\\/])*\\.\\.' + pathname + '|' : '') + pathname})([^,]*)`, 'g');
                                                while (match = pattern.exec(srcset)) {
                                                    if (!resolve || uri === Document.resolvePath(match[2], baseUri)) {
                                                        current = current.replace(match[0], match[1] + value + match[3]);
                                                    }
                                                }
                                            }
                                            attribs.srcset = current;
                                            if (element.attributes?.srcset) {
                                                break;
                                            }
                                        }
                                    }
                                    default:
                                        attribs.src = value;
                                        break;
                                }
                                replaceHTML = domutils.getOuterHTML(outer);
                            }
                            else {
                                writeFailDOM(err);
                            }
                        }, parserOptions)).end(outerHTML);
                        if (replaceHTML && (replaceIndex(outerIndex, outerCount, outerHTML, replaceHTML) || tryMinify(tagName, tagIndex, tagCount, outerHTML, replaceHTML))) {
                            rebuildIndex(tagName, tagIndex, outerIndex, outerCount, outerHTML, replaceHTML, element);
                        }
                        else {
                            this.writeFail(['Element URL replacement', 'htmlparser2'], getErrorDOM(tagName, tagIndex));
                            delete item.inlineCloud;
                            delete item.inlineBase64;
                        }
                    }
                    else if (base64) {
                        if (cloud?.getStorage('upload', item.cloudStorage)) {
                            value = uuid.v4();
                            item.inlineCloud = value;
                        }
                        let modified: Undef<boolean>;
                        new Parser(new DomHandler((err, dom) => {
                            if (!err) {
                                const related = domutils.findAll(elem => {
                                    if (elem.tagName === 'style') {
                                        return !!elem.children.find((child: domhandler.DataNode) => child.type === 'text' && child.nodeValue.includes(base64));
                                    }
                                    else if (elem.attribs.style?.includes(base64)) {
                                        return true;
                                    }
                                    return false;
                                }, dom);
                                for (const target of related.reverse()) {
                                    const { startIndex, endIndex } = target;
                                    const outerHTML = source.substring(startIndex!, endIndex! + 1);
                                    const replaceHTML = replaceUrl(outerHTML, base64, value, true);
                                    if (replaceHTML) {
                                        const nodes = domutils.findAll(elem => elem.tagName === target.tagName, dom);
                                        const tagIndex = nodes.findIndex(elem => elem === target);
                                        if (tagIndex !== -1) {
                                            spliceSource(replaceHTML, [startIndex!, endIndex! + 1]);
                                            rebuildIndex(target.tagName.toUpperCase(), tagIndex, -1, 0, outerHTML, replaceHTML, null, { nodes, sourceIndex: startIndex! });
                                            ++replaceCount;
                                            modified = true;
                                        }
                                    }
                                }
                            }
                            else {
                                writeFailDOM(err);
                            }
                        }, parserOptions)).end(source);
                        if (!modified) {
                            delete item.inlineCloud;
                        }
                    }
                }
                for (const item of this.assets as DocumentAsset[]) {
                    if (item.trailingContent && !item.invalid) {
                        const pattern = /(\s*)<(script|style)\b[\S\s]+?<\/\s*\2\s*>[ \t]*((?:\r?\n)*)/ig;
                        const value = item.trailingContent.map(content => minifySpace(content));
                        const current = source;
                        while (match = pattern.exec(current)) {
                            const content = findClosingTag(match[2].toUpperCase(), match[0].trim())[2];
                            if (content && value.includes(minifySpace(content))) {
                                source = source.replace(match[0], getNewlineString(match[1], match[3]));
                            }
                        }
                        pattern.lastIndex = 0;
                    }
                }
                file.sourceUTF8 = removeFileCommands(transformCss.call(this, instance, file, source) || source);
                this.writeTimeElapsed('HTML', `${path.basename(localUri!)}: ${replaceCount} element${replaceCount > 1 ? 's' : ''} modified`, time);
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
                            else if (match = /^(<[^\s/>]+)(\s*)/.exec(outerHTML)) {
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