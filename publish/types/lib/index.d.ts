/// <reference path="type.d.ts" />

import type { Response } from 'express';
import type { CorsOptions } from 'cors';
import type { WriteStream } from 'fs';

import type { ConfigurationOptions } from 'aws-sdk/lib/core';
import type { GoogleAuthOptions } from 'google-auth-library';

declare namespace functions {
    type BoolString = boolean | string;
    type ExternalCategory = "html" | "css" | "js";
    type FileCompressFormat = "gz" | "br";
    type FileManagerWriteImageCallback = (data: internal.FileData, output: string, command: string, compress?: squared.CompressFormat, error?: Null<Error>) => void;
    type FileManagerPerformAsyncTaskCallback = () => void;
    type FileManagerCompleteAsyncTaskCallback = (value?: unknown, parent?: ExternalAsset) => void;
    type FileOutputCallback = (result: string, err?: Null<Error>) => void;

    namespace squared {
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

        interface FilePostResult {
            success: boolean;
            zipname?: string;
            bytes?: number;
            files?: string[];
            error?: {
                message: string;
                hint?: string;
            };
        }
    }

    namespace chrome {
        interface ChromeAsset {
            rootDir?: string;
            moveTo?: string;
            format?: string;
            tasks?: string[];
            attributes?: AttributeValue[];
            cloudStorage?: CloudService[];
            preserve?: boolean;
            inlineContent?: string;
            exclude?: boolean;
            basePath?: string;
            bundleIndex?: number;
            trailingContent?: FormattableContent[];
            textContent?: string;
            dataMap?: DataMap;
        }

        interface CloudService {
            service: string;
            active?: boolean;
            localStorage?: boolean;
            uploadAll?: boolean;
            filename?: string;
            apiEndpoint?: string;
            settings?: string;
            [key: string]: Undef<unknown>;
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

        interface TranspileMap {
            html: ObjectMap<StringMap>;
            js: ObjectMap<StringMap>;
            css: ObjectMap<StringMap>;
        }
    }

    namespace internal {
        namespace serve {
            interface Routing {
                [key: string]: Route[];
            }

            interface Route {
                mount?: string;
                path?: string;
            }
        }

        namespace image {
            interface UsingOptions {
                data: FileData;
                command?: string;
                compress?: squared.CompressFormat;
                callback?: FileManagerWriteImageCallback;
            }

            interface RotateData {
                values: number[];
                color: Null<number>;
            }

            interface ResizeData extends Dimension {
                mode: string;
                algorithm: Undef<string>;
                align: Undef<string>[];
                color: Null<number>;
            }

            interface CropData extends Point, Dimension {}

            interface QualityData {
                value: number;
                preset: Undef<string>;
                nearLossless: number;
            }
        }

        interface FileData {
            file: ExternalAsset;
            fileUri: string;
        }

        interface FileOutput {
            pathname: string;
            fileUri: string;
        }

        type Config = StandardMap | string;
        type ConfigOrTranspiler = Config | FunctionType<string>;
        type PluginConfig = [string, Undef<ConfigOrTranspiler>, Config];
    }

    namespace external {
        interface CloudUploadOptions {
            config: chrome.CloudService;
            filename: string;
            fileUri: string;
            mimeType?: string;
        }

        interface StorageSharedKeyCredential {
            accountName: string;
            accountKey: string;
        }

        type CloudServiceClient = (data: chrome.CloudService, settings: StandardMap) => boolean;
        type CloudServiceHost = (this: IFileManager, config: chrome.CloudService) => CloudServiceUpload;
        type CloudServiceUpload = (buffer: Buffer, success: (value?: unknown) => void, options: CloudUploadOptions) => void;
    }

    namespace settings {
        interface CompressModule {
            gzip_level?: NumString;
            brotli_quality?: NumString;
            tinypng_api_key?: string;
        }

        interface CloudModule {
            s3?: {
                [key: string]: ConfigurationOptions;
            };
            azure?: {
                [key: string]: external.StorageSharedKeyCredential;
            };
            gcs?: {
                [key: string]: GoogleAuthOptions;
            };
        }

        interface GulpModule extends StringMap {}

        interface ChromeModule {
            eval_function?: boolean;
            eval_text_template?: boolean;
            html?: ObjectMap<StandardMap>;
            css?: ObjectMap<StandardMap>;
            js?: ObjectMap<StandardMap>;
        }
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
        createWriteStreamAsGzip(source: string, fileUri: string, level?: number): WriteStream;
        createWriteStreamAsBrotli(source: string, fileUri: string, quality?: number, mimeType?: string): WriteStream;
        findFormat(compress: Undef<squared.CompressFormat[]>, format: string): Undef<squared.CompressFormat>;
        hasImageService(): boolean;
        parseSizeRange(value: string): [number, number];
        withinSizeRange(fileUri: string, value: Undef<string>): boolean;
        tryFile(fileUri: string, data: squared.CompressFormat, preCompress?: FileManagerPerformAsyncTaskCallback, postWrite?: FileManagerCompleteAsyncTaskCallback): void;
        tryImage(fileUri: string, callback: FileOutputCallback): void;
    }

    interface IImage extends IModule {
        using(options: internal.image.UsingOptions): void;
        parseCrop(value: string): Undef<internal.image.CropData>;
        parseOpacity(value: string): number;
        parseQuality(value: string): Undef<internal.image.QualityData>;
        parseResize(value: string): Undef<internal.image.ResizeData>;
        parseRotation(value: string): Undef<internal.image.RotateData>;
        parseMethod(value: string): Undef<string[]>;
    }

    interface IChrome extends IModule {
        settings: settings.ChromeModule;
        findPlugin(settings: Undef<ObjectMap<StandardMap>>, name: string): internal.PluginConfig;
        findTranspiler(settings: Undef<ObjectMap<StandardMap>>, name: string, category: ExternalCategory, transpileMap?: chrome.TranspileMap): internal.PluginConfig;
        createTranspiler(value: string): Null<FunctionType<string>>;
        createConfig(value: string): Undef<StandardMap | string>;
        minifyHtml(format: string, value: string, transpileMap?: chrome.TranspileMap): Promise<Void<string>>;
        minifyCss(format: string, value: string, transpileMap?: chrome.TranspileMap): Promise<Void<string>>;
        minifyJs(format: string, value: string, transpileMap?: chrome.TranspileMap): Promise<Void<string>>;
        formatContent(mimeType: string, format: string, value: string, transpileMap?: chrome.TranspileMap): Promise<Void<string>>;
        removeCss(source: string, styles: string[]): Undef<string>;
    }

    interface ICloud extends IModule {
        settings: settings.CloudModule;
        getService(data: Undef<chrome.CloudService[]>): Undef<chrome.CloudService>;
        hasService(data: chrome.CloudService): data is chrome.CloudService;
    }

    interface IFileManager extends IModule {
        serverRoot: string;
        delayed: number;
        cleared: boolean;
        emptyDirectory: boolean;
        productionRelease: boolean;
        basePath?: string;
        Chrome?: IChrome;
        Cloud?: ICloud;
        Gulp?: settings.GulpModule;
        readonly files: Set<string>;
        readonly filesQueued: Set<string>;
        readonly filesToRemove: Set<string>;
        readonly filesToCompare: Map<ExternalAsset, string[]>;
        readonly contentToAppend: Map<string, string[]>;
        readonly dirname: string;
        readonly assets: ExternalAsset[];
        readonly postFinalize: FunctionType<void>;
        readonly dataMap: chrome.DataMap;
        readonly baseAsset?: ExternalAsset;
        install(name: string, ...args: unknown[]): void;
        add(value: string): void;
        delete(value: string): void;
        has(value: Undef<string>): boolean;
        replace(file: ExternalAsset, replaceWith: string): void;
        performAsyncTask: FileManagerPerformAsyncTaskCallback;
        removeAsyncTask(): void;
        completeAsyncTask: FileManagerCompleteAsyncTaskCallback;
        performFinalize(): void;
        replacePath(source: string, segments: string[], value: string, matchSingle?: boolean, base64?: boolean): Undef<string>;
        escapePathSeparator(value: string): string;
        getFileOutput(file: ExternalAsset): internal.FileOutput;
        findAsset(uri: string, fromElement?: boolean): Undef<ExternalAsset>;
        getHtmlPages(): ExternalAsset[];
        getRelativeUri(file: ExternalAsset, uri: string): Undef<string>;
        getAbsoluteUri(value: string, href: string): string;
        getFileUri(file: ExternalAsset, filename?: string): string;
        getUTF8String(file: ExternalAsset, fileUri?: string): string;
        appendContent(file: ExternalAsset, fileUri: string, content: string, bundleIndex: number): Promise<string>;
        getTrailingContent(file: ExternalAsset): Promise<string>;
        transformCss(file: ExternalAsset, content: string): Undef<string>;
        newImage(data: internal.FileData, ouputType: string, saveAs: string, command?: string): string;
        transformBuffer(data: internal.FileData): Promise<void>;
        writeBuffer(data: internal.FileData): void;
        finalizeImage: FileManagerWriteImageCallback;
        finalizeFile(data: internal.FileData, parent?: ExternalAsset): Promise<void>;
        processAssets(): void;
        finalizeAssets(): Promise<unknown[]>;
    }

    interface FileManagerConstructor {
        checkPermissions(dirname: string, res?: Response): boolean;
        loadSettings(value: Settings, ignorePermissions?: boolean): void;
        moduleNode(): INode;
        moduleCompress(): ICompress;
        moduleImage(): IImage;
        moduleChrome(): IChrome;
        moduleCloud(): ICloud;
        new(dirname: string, body: RequestBody, postFinalize: FunctionType<void>, productionRelease?: boolean): IFileManager;
    }

    const FileManager: FileManagerConstructor;

    interface IModule {
        readonly major: number;
        readonly minor: number;
        readonly patch: number;
        checkVersion(major: number, minor: number, patch?: number): boolean;
        getFileSize(fileUri: string): number;
        replaceExtension(value: string, ext: string): string;
        getTempDir(): string;
        writeMessage(value: string, message: unknown, title?: string, color?: "green" | "yellow" | "blue" | "white" | "grey"): void;
        writeFail(value: string, message: unknown): void;
    }

    interface ModuleConstructor {
        new(): IModule;
    }

    const Module: ModuleConstructor;

    class ImageProxy<T> {
        instance: T;
        fileUri: string
        command: string
        resizeData?: internal.image.ResizeData;
        cropData?: internal.image.CropData;
        rotateData?: internal.image.RotateData;
        qualityData?: internal.image.QualityData;
        opacityValue: number;
        errorHandler?: (err: Error) => void;
        method(): void;
        resize(): void;
        crop(): void;
        opacity(): void;
        quality(): void;
        rotate(parent?: ExternalAsset, preRotate?: FileManagerPerformAsyncTaskCallback, postWrite?: FileManagerCompleteAsyncTaskCallback): void;
        write(output: string, options?: internal.image.UsingOptions): void;
        finalize(output: string, callback: (result: string) => void): void;
        constructor(instance: T, fileUri: string, command?: string, finalAs?: string);
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

    interface Settings {
        version?: string;
        disk_read?: BoolString;
        disk_write?: BoolString;
        unc_read?: BoolString;
        unc_write?: BoolString;
        cors?: CorsOptions;
        request_post_limit?: string;
        env?: string;
        port?: StringMap;
        routing?: internal.serve.Routing;
        compress?: settings.CompressModule;
        cloud?: settings.CloudModule;
        gulp?: settings.GulpModule;
        chrome?: settings.ChromeModule;
    }

    interface RequestBody {
        assets: ExternalAsset[];
        dataMap?: chrome.DataMap;
    }

    interface ExternalAsset extends squared.FileAsset, chrome.ChromeAsset {
        fileUri?: string;
        transforms?: string[];
        invalid?: boolean;
        buffer?: Buffer;
        sourceUTF8?: string;
        inlineBase64?: string;
        inlineCloud?: string;
        inlineCssCloud?: string;
        originalName?: string;
    }
}

export = functions;
export as namespace functions;