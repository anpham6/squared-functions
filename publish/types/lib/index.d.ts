/// <reference path="type.d.ts" />

import type { WriteStream } from 'fs';
import type { Response } from 'express';
import type { CorsOptions } from 'cors';
import type { BackgroundColor, ForegroundColor } from 'chalk';

type BoolString = boolean | string;

declare namespace functions {
    type ExternalCategory = "html" | "css" | "js";
    type CloudFeatures = "storage" | "database";
    type CloudFunctions = "upload" | "download";
    type FileManagerWriteImageCallback = (data: internal.FileData, output: string, options?: internal.Image.UsingOptions, error?: Null<Error>) => void;
    type FileManagerPerformAsyncTaskCallback = (parent?: ExternalAsset) => void;
    type FileManagerCompleteAsyncTaskCallback = (value?: unknown, parent?: ExternalAsset) => void;
    type CompressTryImageCallback = (result: string) => void;

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
            cloudStorage?: CloudStorage[];
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
            credential: string | PlainObject;
        }

        interface CloudDatabase<T = string | PlainObject | any[]> extends CloudService {
            table: string;
            value: string | ObjectMap<string | string[]>;
            name?: string;
            id?: string;
            query?: T;
            limit?: number;
            params?: unknown[];
            options?: PlainObject;
            element?: {
                outerHTML?: string;
            };
        }

        interface CloudStorage extends CloudService {
            bucket?: string;
            admin?: CloudStorageAdmin;
            upload?: CloudStorageUpload;
            download?: CloudStorageDownload;
        }

        interface CloudStorageAdmin {
            publicRead?: boolean;
            emptyBucket?: boolean;
            preservePath?: boolean;
        }

        interface CloudStorageAction extends Partial<LocationUri> {
            active?: boolean;
            overwrite?: boolean;
        }

        interface CloudStorageUpload extends CloudStorageAction {
            localStorage?: boolean;
            endpoint?: string;
            all?: boolean;
            publicRead?: boolean;
        }

        interface CloudStorageDownload extends CloudStorageAction {
            versionId?: string;
            deleteObject?: string;
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
        type OutputAttribute = KeyValue<string, Null<string>>;
        type UnusedStyles = string[];

        interface ChromeAsset {
            rootDir?: string;
            moveTo?: string;
            format?: string;
            preserve?: boolean;
            exclude?: boolean;
            baseUrl?: string;
            bundleId?: number;
            bundleIndex?: number;
            bundleRoot?: string;
            outerHTML?: string;
            trailingContent?: FormattableContent[];
            inlineContent?: string;
            attributes?: ObjectMap<Undef<Null<string>>>;
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
                command?: string;
                output?: string;
                compress?: squared.CompressFormat;
                time?: number;
                callback?: FileManagerWriteImageCallback;
            }

            interface RotateData {
                values: number[];
                color: number;
            }

            interface ResizeData extends Dimension {
                mode: string;
                color: number;
                align: Undef<string>[];
                algorithm?: string;
            }

            interface CropData extends Point, Dimension {}

            interface QualityData {
                value: number;
                nearLossless: number;
                preset?: string;
            }
        }

        namespace Chrome {
            interface SourceMapInput {
                file: ExternalAsset;
                fileUri: string;
                sourcesContent: Null<string>;
                sourceMap: Map<string, SourceMapOutput>;
                map?: SourceMap;
                nextMap: (name: string, map: SourceMap | string, value: string, includeSources?: boolean) => boolean;
            }

            interface SourceMapOutput {
                value: string;
                map: SourceMap;
                sourcesContent: Null<string>;
                url?: string;
            }

            interface SourceMap {
                version: number;
                sources: string[];
                names: string[];
                mappings: string;
                file?: string;
                sourceRoot?: string;
                sourcesContent?: Null<string>[];
            }

            type ConfigOrTranspiler = StandardMap | FunctionType<string>;
            type PluginConfig = [string, Undef<ConfigOrTranspiler>, Undef<StandardMap>] | [];
        }

        namespace Cloud {
            type InstanceHost = ICloud | IFileManager;

            interface FunctionData {
                admin?: squared.CloudStorageAdmin;
                bucket?: string;
                bucketGroup?: string;
            }

            interface UploadData extends FunctionData {
                upload: squared.CloudStorageUpload;
                buffer: Buffer;
                fileUri: string;
                fileGroup: [Buffer | string, string][];
                filename?: string;
                mimeType?: string;
            }

            interface DownloadData extends FunctionData {
                download: squared.CloudStorageDownload;
            }

            interface ServiceClient {
                validateStorage?(credential: PlainObject, data?: squared.CloudService): boolean;
                validateDatabase?(credential: PlainObject, data?: squared.CloudService): boolean;
                createStorageClient?<T>(this: InstanceHost, credential: unknown, service?: string): T;
                createDatabaseClient?<T>(this: InstanceHost, credential: unknown): T;
                createBucket?(this: InstanceHost, credential: unknown, bucket: string, publicRead?: boolean, service?: string, sdk?: string): Promise<boolean>;
                deleteObjects?(this: InstanceHost, credential: unknown, bucket: string, service?: string, sdk?: string): Promise<void>;
                executeQuery?(this: InstanceHost, credential: unknown, data: squared.CloudDatabase, cacheKey?: string): Promise<PlainObject[]>;
            }

            type ServiceHost<T> = (this: InstanceHost, credential: unknown, service?: string, sdk?: string) => T;
            type UploadHost = ServiceHost<UploadCallback>;
            type DownloadHost = ServiceHost<DownloadCallback>;
            type UploadCallback = (data: UploadData, success: (value: string) => void) => Promise<void>;
            type DownloadCallback = (data: DownloadData, success: (value: Null<Buffer | string>) => void) => Promise<void>;
        }

        interface FileData {
            file: ExternalAsset;
            fileUri: string;
        }

        interface FileOutput {
            pathname: string;
            fileUri: string;
        }

        enum LOG_TYPE {
            UNKNOWN = 0,
            SYSTEM = 1,
            CHROME = 2,
            COMPRESS = 4,
            IMAGE = 8,
            NODE = 16,
            WATCH = 32,
            CLOUD_STORAGE = 64,
            CLOUD_DATABASE = 128,
            TIME_ELAPSED = 256
        }

        interface LogMessageOptions {
            titleColor?: typeof ForegroundColor;
            titleBgColor?: typeof BackgroundColor;
            valueColor?: typeof ForegroundColor;
            valueBgColor?: typeof BackgroundColor;
            hintColor?: typeof ForegroundColor;
            hintBgColor?: typeof BackgroundColor;
            messageColor?: typeof ForegroundColor;
            messageBgColor?: typeof BackgroundColor;
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
        tryFile(fileUri: string, data: squared.CompressFormat, initialize?: Null<FileManagerPerformAsyncTaskCallback>, callback?: FileManagerCompleteAsyncTaskCallback): void;
        tryImage(fileUri: string, callback: CompressTryImageCallback): void;
    }

    interface IImage extends IModule {
        parseCrop(value: string): Undef<internal.Image.CropData>;
        parseOpacity(value: string): number;
        parseQuality(value: string): Undef<internal.Image.QualityData>;
        parseResize(value: string): Undef<internal.Image.ResizeData>;
        parseRotation(value: string): Undef<internal.Image.RotateData>;
        parseMethod(value: string): Undef<string[]>;
    }

    interface ImageConstructor extends ModuleConstructor {
        resolveMime(this: IFileManager, data: internal.FileData): Promise<boolean>;
        using(this: IFileManager, data: internal.FileData, options?: internal.Image.UsingOptions): void;
        new(): IImage;
    }

    const Image: ImageConstructor;

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
        rotate(initialize?: FileManagerPerformAsyncTaskCallback, callback?: FileManagerCompleteAsyncTaskCallback, parent?: ExternalAsset): void;
        write(data: internal.FileData, output: string, options?: internal.Image.UsingOptions): void;
        finalize(output: string, callback: (result: string) => void): void;
        constructor(instance: T, fileUri: string, command?: string, finalAs?: string);
    }

    interface ICloud extends IModule {
        settings: ExtendedSettings.CloudModule;
        database: squared.CloudDatabase[];
        setObjectKeys(assets: ExternalAsset[]): void;
        createBucket(service: string, credential: unknown, bucket: string, publicRead?: boolean): Promise<boolean>;
        deleteObjects(service: string, credential: unknown, bucket: string): Promise<void>;
        downloadObject(service: string, credential: PlainObject, bucket: string, download: squared.CloudStorageDownload, callback: (value: Null<Buffer | string>) => void, bucketGroup?: string): Promise<void>;
        getStorage(action: CloudFunctions, data: Undef<squared.CloudStorage[]>): Undef<squared.CloudStorage>;
        hasStorage(action: CloudFunctions, storage: squared.CloudStorage): squared.CloudStorageUpload | false;
        getDatabaseRows(database: squared.CloudDatabase, cacheKey?: string): Promise<PlainObject[]>;
        hasCredential(feature: CloudFeatures, data: squared.CloudService): boolean;
        getCredential(data: squared.CloudService): PlainObject;
        getUploadHandler(service: string, credential: PlainObject): internal.Cloud.UploadCallback;
        getDownloadHandler(service: string, credential: PlainObject): internal.Cloud.DownloadCallback;
    }

    interface CloudConstructor extends ModuleConstructor {
        new(settings: ExtendedSettings.CloudModule): ICloud;
    }

    const Cloud: CloudConstructor;

    interface IChrome extends IModule {
        settings: ExtendedSettings.ChromeModule;
        serverRoot: string;
        productionRelease: boolean;
        unusedStyles?: string[];
        transpileMap?: chrome.TranspileMap;
        findPlugin(settings: Undef<ObjectMap<StandardMap>>, name: string): internal.Chrome.PluginConfig;
        findTranspiler(settings: Undef<ObjectMap<StandardMap>>, name: string, category: ExternalCategory): internal.Chrome.PluginConfig;
        loadOptions(value: internal.Chrome.ConfigOrTranspiler | string): Undef<internal.Chrome.ConfigOrTranspiler>;
        loadConfig(value: string): Undef<StandardMap | string>;
        loadTranspiler(value: string): Null<FunctionType<string>>;
        transform(type: ExternalCategory, format: string, value: string, input: internal.Chrome.SourceMapInput): Promise<Void<[string, Map<string, internal.Chrome.SourceMapOutput>]>>;
    }

    interface IWatch extends IModule {
        interval: number;
        whenModified?: (assets: ExternalAsset[]) => void;
        start(assets: ExternalAsset[]): void;
    }

    interface ChromeConstructor extends ModuleConstructor {
        new(body: RequestBody, settings?: ExtendedSettings.ChromeModule, productionRelease?: boolean): IChrome;
    }

    const Chrome: ChromeConstructor;

    interface IFileManager extends IModule {
        delayed: number;
        cleared: boolean;
        Chrome: Null<IChrome>;
        Cloud: Null<ICloud>;
        Watch: Null<IWatch>;
        Image: Null<ImageConstructor>;
        Compress: Null<ExtendedSettings.CompressModule>;
        Gulp: Null<ExtendedSettings.GulpModule>;
        readonly body: RequestBody;
        readonly files: Set<string>;
        readonly filesQueued: Set<string>;
        readonly filesToRemove: Set<string>;
        readonly filesToCompare: Map<ExternalAsset, string[]>;
        readonly contentToAppend: Map<string, string[]>;
        readonly assets: ExternalAsset[];
        readonly postFinalize: FunctionType<void>;
        readonly baseDirectory: string;
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
        setFileUri(file: ExternalAsset): internal.FileOutput;
        findAsset(uri: string, fromElement?: boolean): Undef<ExternalAsset>;
        findRelativePath(file: ExternalAsset, uri: string): Undef<string>;
        getHtmlPages(): ExternalAsset[];
        removeCwd(value: Undef<string>): string;
        getUTF8String(file: ExternalAsset, fileUri?: string): string;
        appendContent(file: ExternalAsset, fileUri: string, content: string, bundleIndex?: number): Promise<string>;
        getTrailingContent(file: ExternalAsset): Promise<string>;
        getBundleContent(fileUri: string): Undef<string>;
        createSourceMap(file: ExternalAsset, fileUri: string, sourcesContent: string): internal.Chrome.SourceMapInput;
        writeSourceMap(outputData: [string, Map<string, internal.Chrome.SourceMapOutput>], file: ExternalAsset, fileUri: string, sourceContent?: string, modified?: boolean): void;
        removeCss(source: string, styles: string[]): Undef<string>;
        transformCss(file: ExternalAsset, content: string): Undef<string>;
        transformSource(data: internal.FileData, module?: IChrome): Promise<void>;
        queueImage(data: internal.FileData, ouputType: string, saveAs: string, command?: string): string;
        compressFile(file: ExternalAsset): Promise<unknown>;
        finalizeImage: FileManagerWriteImageCallback;
        finalizeAsset(data: internal.FileData, parent?: ExternalAsset): Promise<void>;
        processAssets(watch?: boolean): void;
        finalize(): Promise<void>;
    }

    interface FileManagerConstructor extends ModuleConstructor {
        hasPermissions(dirname: string, res?: Response): boolean;
        loadSettings(value: Settings, ignorePermissions?: boolean): void;
        moduleNode(): INode;
        moduleCompress(): ICompress;
        new(dirname: string, body: RequestBody, postFinalize?: FunctionType<void>): IFileManager;
    }

    const FileManager: FileManagerConstructor;

    interface IModule {
        logType: typeof internal.LOG_TYPE;
        readonly major: number;
        readonly minor: number;
        readonly patch: number;
        supported(major: number, minor: number, patch?: number): boolean;
        joinPosix(...paths: string[]): string;
        getTempDir(): string;
        formatMessage(type: internal.LOG_TYPE, title: string, value: string | [string, string], message?: unknown, options?: internal.LogMessageOptions): void;
        formatFail(type: internal.LOG_TYPE, title: string, value: string | [string, string], message?: unknown): void;
        writeFail(value: string | [string, string], message?: unknown): void;
        writeTimeElapsed(title: string, value: string, time: number, options?: internal.LogMessageOptions): void;
        writeMessage(title: string, value: string, message?: unknown, options?: internal.LogMessageOptions): void;
    }

    interface ModuleConstructor {
        loadSettings(value: Settings): void;
        getFileSize(fileUri: string): number;
        toPosix(value: string, filename?: string): string;
        renameExt(value: string, ext: string): string;
        new(): IModule;
    }

    const Module: ModuleConstructor;

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
        env?: string;
        port?: StringMap;
        routing?: internal.Serve.Routing;
        request_post_limit?: string;
        logger?: ExtendedSettings.LoggerModule;
        watch?: ExtendedSettings.WatchModule;
        image?: ExtendedSettings.ImageModule;
        compress?: ExtendedSettings.CompressModule;
        cloud?: ExtendedSettings.CloudModule;
        gulp?: ExtendedSettings.GulpModule;
        chrome?: ExtendedSettings.ChromeModule;
    }

    namespace ExtendedSettings {
        interface LoggerModule {
            unknown?: boolean;
            system?: boolean;
            chrome?: boolean;
            compress?: boolean;
            image?: boolean;
            node?: boolean;
            watch?: boolean;
            cloud_storage?: boolean;
            cloud_database?: boolean;
            time_elapsed?: boolean;
        }

        interface ImageModule {
            proxy?: string;
        }

        interface CompressModule {
            gzip_level?: NumString;
            brotli_quality?: NumString;
            tinypng_api_key?: string;
        }

        interface CloudModule {
            aws?: ObjectMap<StringMap>;
            azure?: ObjectMap<StringMap>;
            gcloud?: ObjectMap<StringMap>;
            ibm?: ObjectMap<StringMap>;
            oci?: ObjectMap<StringMap>;
        }

        interface GulpModule extends StringMap {}

        interface ChromeModule extends Partial<chrome.TranspileMap> {
            eval_function?: boolean;
            eval_text_template?: boolean;
        }

        interface WatchModule {
            interval?: number;
        }
    }

    interface RequestBody extends PlainObject {
        assets: ExternalAsset[];
        unusedStyles?: chrome.UnusedStyles;
        transpileMap?: chrome.TranspileMap;
        database?: squared.CloudDatabase[];
    }

    interface ExternalAsset extends squared.FileAsset, chrome.ChromeAsset {
        fileUri?: string;
        buffer?: Buffer;
        sourceUTF8?: string;
        cloudUri?: string;
        relativePath?: string;
        originalName?: string;
        transforms?: string[];
        inlineBase64?: string;
        inlineCloud?: string;
        inlineCssCloud?: string;
        inlineCssMap?: StringMap;
        etag?: string;
        invalid?: boolean;
    }
}

export = functions;
export as namespace functions;