/// <reference path="file.d.ts" />
/// <reference path="type.d.ts" />

import type { Response } from 'express';
import type { CorsOptions } from 'cors';
import type { WriteStream } from 'fs';
import type { Options as PrettierOptions } from 'prettier';
import type * as jimp from 'jimp';

type BoolString = boolean | string;
type ExternalCategory = "html" | "css" | "js";

interface INode extends IModule {
    enableDiskRead(): void;
    enableDiskWrite(): void;
    enableUNCRead(): void;
    enableUNCWrite(): void;
    canReadDisk(): boolean;
    canWriteDisk(): boolean;
    canReadUNC(): boolean;
    canWriteUNC(): boolean;
    isFileURI(value: string): boolean;
    isFileUNC(value: string): boolean;
    isDirectoryUNC(value: string): boolean;
    fromSameOrigin(base: string, other: string): boolean;
    parsePath(value: string): Undef<string>;
    resolvePath(value: string, href: string, hostname?: boolean): Undef<string>;
}

interface ICompress extends IModule {
    gzipLevel: number;
    brotliQuality: number;
    tinifyApiKey: string;
    createWriteStreamAsGzip(source: string, filepath: string, level?: number): WriteStream;
    createWriteStreamAsBrotli(source: string, filepath: string, quality?: number, mimeType?: string): WriteStream;
    findFormat(compress: Undef<CompressFormat[]>, format: string): Undef<CompressFormat>;
    findCompress(compress: Undef<CompressFormat[]>): Undef<CompressFormat>;
    removeFormat(compress: Undef<CompressFormat[]>, format: string): void;
    getSizeRange(value: string): [number, number];
    withinSizeRange(filepath: string, value: Undef<string>): boolean;
}

interface IImage extends IModule {
    jpegQuality: number;
    isJpeg(filename: string, mimeType?: string, filepath?: string): boolean;
    parseResizeMode(value: string): Undef<ResizeData>;
    parseOpacity(value: string): Undef<number>;
    parseRotation(value: string): Undef<RotateData>;
    resize(self: jimp, options: ResizeData): jimp;
    rotate(self: jimp, options: RotateData, filepath: string, preRotate?: () => void, postWrite?: (result?: any) => void): jimp;
    opacity(self: jimp, value: Undef<number>): jimp;
}

interface IChrome extends IModule {
    modules: Undef<ChromeModules>;
    findPlugin(data: ObjectMap<StandardMap>, name: string): [string, StandardMap | FunctionType<string>];
    findTranspiler(config: ObjectMap<StandardMap>, name: string, category: ExternalCategory, transpileMap?: TranspileMap): [string, StandardMap | FunctionType<string>];
    createTranspiler(value: string): Null<FunctionType<string>>;
    setPrettierOptions(options: PrettierOptions): PrettierOptions;
    minifyHtml(format: string, value: string, transpileMap?: TranspileMap): Promise<Void<string>>;
    minifyCss(format: string, value: string, transpileMap?: TranspileMap): Promise<Void<string>>;
    minifyJs(format: string, value: string, transpileMap?: TranspileMap): Promise<Void<string>>;
    formatContent(mimeType: string, format: string, value: string, transpileMap?: TranspileMap): Promise<Void<string>>;
    removeCss(source: string, styles: string[]): Undef<string>;
}

interface IFileManager extends IModule {
    serverRoot: string;
    delayed: number;
    cleared: boolean;
    emptyDirectory: boolean;
    productionRelease: boolean;
    readonly files: Set<string>;
    readonly filesQueued: Set<string>;
    readonly filesToRemove: Set<string>;
    readonly filesToCompare: Map<ExpressAsset, string[]>;
    readonly contentToAppend: Map<string, string[]>;
    readonly dirname: string;
    readonly assets: ExpressAsset[];
    readonly postFinalize: (this: IFileManager) => void;
    readonly requestMain?: ExpressAsset;
    add(value: string): void;
    delete(value: string): void;
    performAsyncTask(): void;
    removeAsyncTask(): void;
    completeAsyncTask(filepath?: string): void;
    performFinalize(): void;
    replace(file: ExpressAsset, replaceWith: string): void;
    validate(file: ExpressAsset, exclusions: Exclusions): boolean;
    getFileOutput(file: ExpressAsset): { pathname: string; filepath: string };
    getRelativeUrl(file: ExpressAsset, url: string): Undef<string>;
    getAbsoluteUrl(value: string, href: string): string;
    getFullUri(file: ExpressAsset, filename?: string): string;
    replacePath(source: string, segment: string, value: string, base64?: boolean): Undef<string>;
    replaceExtension(value: string, ext: string): string;
    getTrailingContent(file: ExpressAsset): Promise<string>;
    appendContent(file: ExpressAsset, content: string, outputOnly?: boolean): Promise<string>;
    transformBuffer(assets: ExpressAsset[], file: ExpressAsset, filepath: string): Promise<void>;
    transformCss(file: ExpressAsset, content: string): Undef<string>;
    compressFile(assets: ExpressAsset[], file: ExpressAsset, filepath: string, cached?: boolean): void;
    writeBuffer(assets: ExpressAsset[], file: ExpressAsset, filepath: string, cached?: boolean): void;
    processAssets(): void;
    finalizeAssets(release: boolean): Promise<void[]>;
}

interface FileManagerConstructor {
    checkPermissions(res: Response, dirname: string): boolean;
    loadSettings(value: Settings, ignorePermissions?: boolean): void;
    moduleNode(): INode;
    moduleCompress(): ICompress;
    moduleImage(): IImage;
    moduleChrome(): IChrome;
    new(dirname: string, assets: ExpressAsset[], postFinalize: (this: functions.IFileManager) => void, productionRelease?: boolean): IFileManager;
}

declare const FileManager: FileManagerConstructor;

interface IModule {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    checkVersion(major: number, minor: number, patch?: number): boolean;
    getFileSize(filepath: string): number;
    writeFail(description: string, message: any): void;
}

interface ModuleConstructor {
    new(): IModule;
}

declare const Module: ModuleConstructor;

interface Settings {
    version?: string;
    disk_read?: BoolString;
    disk_write?: BoolString;
    unc_read?: BoolString;
    unc_write?: BoolString;
    cors?: CorsOptions;
    request_post_limit?: string;
    gzip_level?: NumString;
    brotli_quality?: NumString;
    jpeg_quality?: NumString;
    tinypng_api_key?: string;
    env?: string;
    port?: StringMap;
    routing?: Routing;
    chrome?: ChromeModules;
}

interface Arguments {
    accessAll?: boolean;
    accessDisk?: boolean;
    accessUnc?: boolean;
    diskRead?: boolean;
    diskWrite?: boolean;
    uncRead?: boolean;
    uncWrite?: boolean;
    env?: string;
    port?: number;
    cors?: string;
}

interface Routing {
    [key: string]: Route[];
}

interface Route {
    mount?: string;
    path?: string;
}

interface TranspileMap {
    html: ObjectMap<StringMap>;
    js: ObjectMap<StringMap>;
    css: ObjectMap<StringMap>;
}

interface ChromeModules {
    eval_function?: boolean;
    eval_text_template?: boolean;
    html?: ObjectMap<StandardMap>;
    css?: ObjectMap<StandardMap>;
    js?: ObjectMap<StandardMap>;
}

interface ExpressAsset extends FileAsset, ChromeAsset {
    dataMap?: DataMap;
    exclusions?: Exclusions;
    filepath?: string;
    excluded?: boolean;
    originalName?: string;
    toBase64?: string;
}

interface DataMap {
    unusedStyles?: string[];
    transpileMap?: TranspileMap;
}

interface RotateData {
    values: number[];
    color: Null<number>;
}

interface ResizeData {
    width: number;
    height: number;
    mode: string;
    algorithm: string;
    align: number;
    color: Null<number>;
}

export as namespace functions;