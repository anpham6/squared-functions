/// <reference path="type.d.ts" />

import type { Response } from 'express';
import type { CorsOptions } from 'cors';
import type { WriteStream } from 'fs';

declare namespace functions {
    type BoolString = boolean | string;
    type ExternalCategory = "html" | "css" | "js";
    type FileCompressFormat = "gz" | "br";
    type FileManagerWriteImageCallback = (data: internal.FileData, output: string, command: string, compress?: squared.base.CompressFormat, err?: Null<Error>) => void;
    type FileManagerPerformAsyncTaskCallback = () => void;
    type FileManagerCompleteAsyncTaskCallback = (filepath?: string) => void;
    type FileOutputCallback = (result: string, err?: Null<Error>) => void;

    namespace squared {
        namespace base {
            interface LocationUri {
                pathname: string;
                filename: string;
            }

            interface FileAsset extends LocationUri {
                content?: string;
                uri?: string;
                mimeType?: string;
                base64?: string;
                commands?: string[];
                compress?: CompressFormat[];
            }

            interface CompressFormat {
                format: string;
                level?: number;
                condition?: string;
            }

            interface ResultOfFileAction {
                success: boolean;
                zipname?: string;
                bytes?: number;
                files?: string[];
                application?: string;
                system?: string;
            }
        }
    }

    namespace chrome {
        interface ChromeAsset {
            rootDir?: string;
            moveTo?: string;
            format?: string;
            tasks?: string[];
            attributes?: AttributeValue[];
            preserve?: boolean;
            inlineContent?: string;
            exclude?: boolean;
            basePath?: string;
            bundleIndex?: number;
            trailingContent?: FormattableContent[];
            textContent?: string;
            dataMap?: DataMap;
        }

        interface AttributeValue {
            name: string;
            value?: Null<string>;
        }

        interface FormattableContent {
            value: string;
            format?: string;
            preserve?: boolean;
        }

        interface DataMap {
            unusedStyles?: string[];
            transpileMap?: TranspileMap;
        }
    }

    namespace internal {
        interface ImageUsingOptions {
            data: FileData;
            command?: string;
            compress?: squared.base.CompressFormat;
            callback?: FileManagerWriteImageCallback;
        }

        interface RotateData {
            values: number[];
            color: Null<number>;
        }

        interface ResizeData extends Dimension {
            mode: string;
            algorithm: string;
            align: number;
            color: Null<number>;
        }

        interface CropData extends Point, Dimension {}

        interface QualityData {
            value: number;
            preset?: string;
        }

        interface FileData {
            file: ExpressAsset;
            filepath: string;
        }

        interface FileOutput {
            pathname: string;
            filepath: string;
        }

        type Config = StandardMap | string;
        type ConfigOrTranspiler = Config | FunctionType<string>;
        type PluginConfig = [string, Undef<ConfigOrTranspiler>, Config];
    }

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
        fromSameOrigin(value: string, other: string): boolean;
        parsePath(value: string): Undef<string>;
        resolvePath(value: string, href: string, hostname?: boolean): Undef<string>;
        toPosixPath(value: string): string;
    }

    interface ICompress extends IModule {
        gzipLevel: number;
        brotliQuality: number;
        tinifyApiKey: string;
        createWriteStreamAsGzip(source: string, filepath: string, level?: number): WriteStream;
        createWriteStreamAsBrotli(source: string, filepath: string, quality?: number, mimeType?: string): WriteStream;
        findFormat(compress: Undef<squared.base.CompressFormat[]>, format: string): Undef<squared.base.CompressFormat>;
        hasImageService(): boolean;
        parseSizeRange(value: string): [number, number];
        withinSizeRange(filepath: string, value: Undef<string>): boolean;
        tryFile(data: internal.FileData, format: FileCompressFormat, preCompress?: FileManagerPerformAsyncTaskCallback, postWrite?: FileManagerCompleteAsyncTaskCallback): void;
        tryImage(data: internal.FileData, callback: FileOutputCallback): void;
    }

    interface IImage extends IModule {
        using(options: internal.ImageUsingOptions): void;
        parseResize(value: string): Undef<internal.ResizeData>;
        parseCrop(value: string): Undef<internal.CropData>;
        parseOpacity(value: string): number;
        parseQuality(value: string): Undef<internal.QualityData>;
        parseRotation(value: string): Undef<internal.RotateData>;
    }

    interface IChrome extends IModule {
        modules?: ChromeModules;
        findPlugin(settings: Undef<ObjectMap<StandardMap>>, name: string): internal.PluginConfig;
        findTranspiler(settings: Undef<ObjectMap<StandardMap>>, name: string, category: ExternalCategory, transpileMap?: TranspileMap): internal.PluginConfig;
        createTranspiler(value: string): Null<FunctionType<string>>;
        createConfig(value: string): Undef<StandardMap | string>;
        minifyHtml(format: string, value: string, transpileMap?: TranspileMap): Promise<Void<string>>;
        minifyCss(format: string, value: string, transpileMap?: TranspileMap): Promise<Void<string>>;
        minifyJs(format: string, value: string, transpileMap?: TranspileMap): Promise<Void<string>>;
        formatContent(mimeType: string, format: string, value: string, transpileMap?: TranspileMap): Promise<Void<string>>;
        removeCss(source: string, styles: string[]): Undef<string>;
    }

    interface ChromeConstructor {
        new(modules?: ChromeModules): IChrome;
    }

    const Chrome: ChromeConstructor;

    interface IFileManager extends IModule {
        serverRoot: string;
        delayed: number;
        cleared: boolean;
        emptyDirectory: boolean;
        productionRelease: boolean;
        basePath?: string;
        Gulp?: StringMap;
        readonly files: Set<string>;
        readonly filesQueued: Set<string>;
        readonly filesToRemove: Set<string>;
        readonly filesToCompare: Map<ExpressAsset, string[]>;
        readonly contentToAppend: Map<string, string[]>;
        readonly dirname: string;
        readonly assets: ExpressAsset[];
        readonly postFinalize: FunctionType<void>;
        readonly dataMap: chrome.DataMap;
        readonly baseAsset?: ExpressAsset;
        install(name: string, ...args: any[]): void;
        add(value: string): void;
        delete(value: string): void;
        replace(file: ExpressAsset, replaceWith: string): void;
        performAsyncTask: FileManagerPerformAsyncTaskCallback;
        removeAsyncTask(): void;
        completeAsyncTask: FileManagerCompleteAsyncTaskCallback;
        performFinalize(): void;
        getHtmlPages(modified?: boolean): ExpressAsset[];
        replacePath(source: string, segments: string[], value: string, matchSingle?: boolean, base64?: boolean): Undef<string>;
        escapePathSeparator(value: string): string;
        getFileOutput(file: ExpressAsset): internal.FileOutput;
        getRelativeUri(file: ExpressAsset, uri: string): Undef<string>;
        getAbsoluteUri(value: string, href: string): string;
        getFileUri(file: ExpressAsset, filename?: string): string;
        getUTF8String(file: ExpressAsset, filepath?: string): string;
        appendContent(file: ExpressAsset, filepath: string, content: string, bundleIndex: number): Promise<string>;
        getTrailingContent(file: ExpressAsset): Promise<string>;
        transformCss(file: ExpressAsset, content: string): Undef<string>;
        newImage(data: internal.FileData, ouputType: string, saveAs: string, command?: string): string;
        replaceImage(data: internal.FileData, output: string, command: string): void;
        transformBuffer(data: internal.FileData): Promise<void>;
        writeBuffer(data: internal.FileData): void;
        finalizeImage: FileManagerWriteImageCallback;
        finalizeFile(data: internal.FileData): void;
        processAssets(): void;
        finalizeAssets(): Promise<unknown[]>;
    }

    interface FileManagerConstructor {
        checkPermissions(dirname: string, res?: Response): boolean;
        loadSettings(value: Settings, ignorePermissions?: boolean): void;
        moduleNode(): INode;
        moduleCompress(): ICompress;
        moduleImage(): IImage;
        new(dirname: string, assets: ExpressAsset[], postFinalize: FunctionType<void>, productionRelease?: boolean): IFileManager;
    }

    const FileManager: FileManagerConstructor;

    interface IModule {
        readonly major: number;
        readonly minor: number;
        readonly patch: number;
        checkVersion(major: number, minor: number, patch?: number): boolean;
        getFileSize(filepath: string): number;
        replaceExtension(value: string, ext: string): string;
        getTempDir(): string;
        writeFail(description: string, message: unknown): void;
    }

    interface ModuleConstructor {
        new(): IModule;
    }

    const Module: ModuleConstructor;

    class ImageProxy<T> {
        instance: T;
        filepath: string
        command: string
        resizeData?: internal.ResizeData;
        cropData?: internal.CropData;
        rotateData?: internal.RotateData;
        qualityData?: internal.QualityData;
        opacityValue: number;
        errorHandler?: (err: Error) => void;
        resize(): void;
        crop(): void;
        opacity(): void;
        quality(): void;
        rotate(preRotate?: FileManagerPerformAsyncTaskCallback, postWrite?: FileManagerCompleteAsyncTaskCallback): void;
        write(output: string, options?: internal.ImageUsingOptions): void;
        finalize(output: string, callback: (result: string) => void): void;
        constructor(instance: T, filepath: string, command?: string, finalAs?: string);
    }

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
        tinypng_api_key?: string;
        env?: string;
        port?: StringMap;
        routing?: Routing;
        gulp?: StringMap;
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

    interface ExpressAsset extends squared.base.FileAsset, chrome.ChromeAsset {
        filepath?: string;
        invalid?: boolean;
        buffer?: Buffer;
        sourceUTF8?: string;
        inlineBase64?: string;
        originalName?: string;
    }
}

export = functions;
export as namespace functions;