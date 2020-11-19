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
    type CloudFunctions = "upload";
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
            watch?: boolean | WatchInterval;
            tasks?: string[];
        }

        interface CompressFormat {
            format: string;
            level?: number;
            condition?: string;
        }

        interface CloudService extends ObjectMap<unknown> {
            service: string;
            settings?: string;
            upload?: CloudServiceUpload;
        }

        interface CloudServiceAction {
            active?: boolean;
        }

        interface CloudServiceUpload extends CloudServiceAction {
            filename?: string;
            localStorage?: boolean;
            apiEndpoint?: string;
            all?: boolean;
            publicAccess?: boolean;
            overwrite?: boolean;
        }

        interface WatchInterval {
            interval?: number;
            expires?: string;
        }

        interface ResponseData {
            success: boolean;
            data?: unknown;
            zipname?: string;
            bytes?: number;
            files?: string[];
            error?: ResponseError;
        }

        interface ResponseError {
            message: string;
            hint?: string;
        }
    }

    namespace chrome {
        interface ChromeAsset {
            rootDir?: string;
            moveTo?: string;
            format?: string;
            preserve?: boolean;
            attributes?: AttributeValue[];
            cloudStorage?: squared.CloudService[];
            basePath?: string;
            bundleId?: number;
            bundleIndex?: number;
            bundleRoot?: string;
            textContent?: string;
            trailingContent?: FormattableContent[];
            inlineContent?: string;
            exclude?: boolean;
        }

        interface AttributeValue {
            name: string;
            value?: Null<string>;
        }

        interface FormattableContent {
            value: string;
            preserve?: boolean;
        }

        interface TranspileMap {
            html: ObjectMap<StringMap>;
            js: ObjectMap<StringMap>;
            css: ObjectMap<StringMap>;
        }
    }

    namespace internal {
        namespace Serve {
            interface Routing {
                [key: string]: Route[];
            }

            interface Route {
                mount?: string;
                path?: string;
            }
        }

        namespace Image {
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

        namespace Chrome {
            interface SourceMapInput {
                file: ExternalAsset;
                fileUri: string;
                sourcesContent: Null<string>;
                sourceMap: Map<string, SourceMapOutput>;
                map?: SourceMap;
                packageName?: string;
                nextMap: (packageName: string, map: SourceMap | string, value: string, includeSources?: boolean) => boolean;
            }

            interface SourceMapOutput {
                value: string;
                map: SourceMap;
                sourcesContent: Null<string>;
                url?: string;
            }

            interface SourceMap {
                version: number;
                file?: string;
                sourceRoot?: string;
                sources: string[];
                sourcesContent?: Null<string>[];
                names: string[];
                mappings: string;
            }

            type ConfigOrTranspiler = StandardMap | FunctionType<string>;
            type PluginConfig = [string, Undef<ConfigOrTranspiler>, Undef<StandardMap>] | [];
        }

        namespace Cloud {
            interface CloudUploadOptions<T>{
                upload: squared.CloudServiceUpload;
                credentials: T;
                fileUri: string;
                filename?: string;
                mimeType?: string;
            }

            type CloudServiceClient = (config: squared.CloudService) => boolean;
            type CloudServiceHost = (this: IFileManager, credentials: PlainObject, serviceName: string) => CloudUploadCallback;
            type CloudUploadCallback = (buffer: Buffer, options: CloudUploadOptions<unknown>, success: (value?: unknown) => void) => void;
        }

        interface FileData {
            file: ExternalAsset;
            fileUri: string;
        }

        interface FileOutput {
            pathname: string;
            fileUri: string;
        }
    }

    namespace external {
        namespace Cloud {
            interface StorageSharedKeyCredential {
                accountName: string;
                accountKey: string;
            }
        }
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
                [key: string]: external.Cloud.StorageSharedKeyCredential;
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
        setDiskRead(): void;
        setDiskWrite(): void;
        setUNCRead(): void;
        setUNCWrite(): void;
        hasDiskRead(): boolean;
        hasDiskWrite(): boolean;
        hasUNCRead(): boolean;
        hasUNCWrite(): boolean;
        isFileURI(value: string): boolean;
        isFileUNC(value: string): boolean;
        isDirectoryUNC(value: string): boolean;
        fromSameOrigin(value: string, other: string): boolean;
        parsePath(value: string): Undef<string>;
        resolvePath(value: string, href: string, hostname?: boolean): Undef<string>;
        toPosix(value: string): string;
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
        using(options: internal.Image.UsingOptions): void;
        parseCrop(value: string): Undef<internal.Image.CropData>;
        parseOpacity(value: string): number;
        parseQuality(value: string): Undef<internal.Image.QualityData>;
        parseResize(value: string): Undef<internal.Image.ResizeData>;
        parseRotation(value: string): Undef<internal.Image.RotateData>;
        parseMethod(value: string): Undef<string[]>;
    }

    interface ICloud extends IModule {
        settings: settings.CloudModule;
        getService(data: Undef<squared.CloudService[]>, functionName: CloudFunctions): Undef<squared.CloudService>;
        hasService(data: squared.CloudService, functionName: CloudFunctions): squared.CloudServiceAction | false;
    }

    interface IChrome extends IModule {
        settings: settings.ChromeModule;
        unusedStyles?: string[];
        transpileMap?: chrome.TranspileMap;
        findPlugin(settings: Undef<ObjectMap<StandardMap>>, name: string): internal.Chrome.PluginConfig;
        findTranspiler(settings: Undef<ObjectMap<StandardMap>>, name: string, category: ExternalCategory): internal.Chrome.PluginConfig;
        loadOptions(value: internal.Chrome.ConfigOrTranspiler | string): Undef<internal.Chrome.ConfigOrTranspiler>;
        loadConfig(value: string): Undef<StandardMap | string>;
        loadTranspiler(value: string): Null<FunctionType<string>>;
        createSourceMap(file: ExternalAsset, fileUri: string, sourcesContent: string): internal.Chrome.SourceMapInput;
        transform(type: ExternalCategory, format: string, value: string, input: internal.Chrome.SourceMapInput): Promise<Void<[string, Map<string, internal.Chrome.SourceMapOutput>]>>;
    }

    interface ChromeConstructor {
        new(): IChrome;
    }

    const Chrome: ChromeConstructor;

    interface IFileManager extends IModule {
        serverRoot: string;
        delayed: number;
        cleared: boolean;
        emptyDirectory: boolean;
        productionRelease: boolean;
        basePath?: string;
        Chrome?: IChrome;
        Cloud?: settings.CloudModule;
        Compress?: settings.CompressModule;
        Gulp?: settings.GulpModule;
        readonly files: Set<string>;
        readonly filesQueued: Set<string>;
        readonly filesToRemove: Set<string>;
        readonly filesToCompare: Map<ExternalAsset, string[]>;
        readonly contentToAppend: Map<string, string[]>;
        readonly dirname: string;
        readonly assets: ExternalAsset[];
        readonly postFinalize: FunctionType<void>;
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
        getBundleContent(fileUri: string): Undef<string>;
        writeSourceMap(file: ExternalAsset, fileUri: string, sourceData: [string, Map<string, internal.Chrome.SourceMapOutput>], sourceContent: string, modified: boolean): void;
        transformCss(file: ExternalAsset, content: string): Undef<string>;
        removeCss(source: string, styles: string[]): Undef<string>;
        newImage(data: internal.FileData, ouputType: string, saveAs: string, command?: string): string;
        transformBuffer(data: internal.FileData): Promise<void>;
        writeBuffer(data: internal.FileData): void;
        finalizeImage: FileManagerWriteImageCallback;
        finalizeAsset(data: internal.FileData, parent?: ExternalAsset): Promise<void>;
        processAssets(watch?: boolean): void;
        finalize(): Promise<unknown[]>;
    }

    interface FileManagerConstructor {
        checkPermissions(dirname: string, res?: Response): boolean;
        loadSettings(value: Settings, ignorePermissions?: boolean): void;
        moduleNode(): INode;
        moduleCompress(): ICompress;
        moduleImage(): IImage;
        moduleCloud(): ICloud;
        new(dirname: string, body: RequestBody, postFinalize?: FunctionType<void>): IFileManager;
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
        writeMessage(value: string, message?: unknown, title?: string, color?: "green" | "yellow" | "blue" | "white" | "grey"): void;
        writeFail(value: string, message?: unknown): void;
    }

    interface ModuleConstructor {
        new(): IModule;
    }

    const Module: ModuleConstructor;

    class ImageProxy<T> {
        instance: T;
        fileUri: string
        command: string
        resizeData?: internal.Image.ResizeData;
        cropData?: internal.Image.CropData;
        rotateData?: internal.Image.RotateData;
        qualityData?: internal.Image.QualityData;
        opacityValue: number;
        errorHandler?: (err: Error) => void;
        method(): void;
        resize(): void;
        crop(): void;
        opacity(): void;
        quality(): void;
        rotate(parent?: ExternalAsset, preRotate?: FileManagerPerformAsyncTaskCallback, postWrite?: FileManagerCompleteAsyncTaskCallback): void;
        write(output: string, options?: internal.Image.UsingOptions): void;
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
        watch_interval?: number;
        env?: string;
        port?: StringMap;
        routing?: internal.Serve.Routing;
        compress?: settings.CompressModule;
        cloud?: settings.CloudModule;
        gulp?: settings.GulpModule;
        chrome?: settings.ChromeModule;
    }

    interface RequestBody extends PlainObject {
        assets: ExternalAsset[];
        unusedStyles?: string[];
        transpileMap?: chrome.TranspileMap;
    }

    interface ExternalAsset extends squared.FileAsset, chrome.ChromeAsset {
        fileUri?: string;
        cloudUri?: string;
        buffer?: Buffer;
        sourceUTF8?: string;
        originalName?: string;
        transforms?: string[];
        inlineBase64?: string;
        inlineCloud?: string;
        inlineCssCloud?: string;
        etag?: string;
        invalid?: boolean;
    }
}

export = functions;
export as namespace functions;