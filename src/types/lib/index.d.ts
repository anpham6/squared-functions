/// <reference path="type.d.ts" />

/* eslint no-shadow: "off" */

import type { BundleAction, CloudDatabase, CloudService, CloudStorage, CloudStorageAdmin, CloudStorageDownload, CloudStorageUpload, CompressFormat, FileAsset, RequestData, ResponseData } from './squared';
import type * as chrome from './chrome';

import type { WriteStream } from 'fs';
import type { Response } from 'express';
import type { BackgroundColor, ForegroundColor } from 'chalk';

type BoolString = boolean | string;

type FileData = functions.Internal.FileData;
type LogMessageOptions = functions.Internal.LogMessageOptions;
type FinalizeState = functions.Internal.Cloud.FinalizeState;
type ResizeData = functions.Internal.Image.ResizeData;
type CropData = functions.Internal.Image.CropData;
type RotateData = functions.Internal.Image.RotateData;
type QualityData = functions.Internal.Image.QualityData;
type SourceMapInput = functions.Internal.Document.SourceMapInput;
type SourceMapOutput = functions.Internal.Document.SourceMapOutput;
type ConfigOrTransformer = functions.Internal.Document.ConfigOrTransformer

declare namespace functions {
    type CloudFeatures = "storage" | "database";
    type CloudFunctions = "upload" | "download";
    type ModuleFormatMessageMethod = (type: Internal.LOG_TYPE, title: string, value: string | [string, string], message?: unknown, options?: LogMessageOptions) => void;
    type ModuleWriteFailMethod = (value: string | [string, string], message?: unknown) => void;
    type FileManagerQueueImageMethod = (data: FileData, ouputType: string, saveAs: string, command?: string) => Undef<string>;
    type FileManagerFinalizeImageMethod<T = void> = (data: Internal.Image.OutputData, error?: Null<Error>) => T;
    type FileManagerPerformAsyncTaskCallback = () => void;
    type FileManagerCompleteAsyncTaskCallback = (value?: unknown, parent?: ExternalAsset) => void;
    type CompressTryFileMethod = (localUri: string, data: CompressFormat, initialize?: Null<FileManagerPerformAsyncTaskCallback>, callback?: FileManagerCompleteAsyncTaskCallback) => void;
    type CompressTryImageCallback = (success?: boolean) => void;

    namespace Internal {
        namespace Image {
            interface OutputData extends FileData {
                output: string;
                command: string;
                baseDirectory?: string;
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

        namespace Document {
            interface SourceMapInput {
                file: ExternalAsset;
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

            type Transformer = FunctionType<Undef<string>>;
            type ConfigOrTransformer = StandardMap | Transformer;
            type PluginConfig = [string, Undef<ConfigOrTransformer>, Undef<StandardMap>] | [];
        }

        namespace Cloud {
            type InstanceHost = ICloud | IFileManager;

            interface CacheTimeout {
                aws?: number;
                azure?: number;
                gcloud?: number;
                ibm?: number;
                oci?: number;
            }

            interface FunctionData {
                admin?: CloudStorageAdmin;
                bucket?: string;
                bucketGroup?: string;
            }

            interface UploadData extends FunctionData {
                upload: CloudStorageUpload;
                buffer: Buffer;
                localUri: string;
                fileGroup: [Buffer | string, string][];
                filename?: string;
                mimeType?: string;
            }

            interface DownloadData extends FunctionData {
                download: CloudStorageDownload;
            }

            interface FinalizeState {
                manager: IFileManager;
                cloud: ICloud;
                bucketGroup: string;
                localStorage: Map<ExternalAsset, CloudStorageUpload>;
                compressed: ExternalAsset[];
            }

            interface ServiceClient {
                validateStorage?(credential: PlainObject, data?: CloudService): boolean;
                validateDatabase?(credential: PlainObject, data?: CloudService): boolean;
                createStorageClient?<T>(this: InstanceHost, credential: unknown, service?: string): T;
                createDatabaseClient?<T>(this: InstanceHost, credential: unknown, data?: CloudService): T;
                createBucket?(this: InstanceHost, credential: unknown, bucket: string, publicRead?: boolean, service?: string, sdk?: string): Promise<boolean>;
                deleteObjects?(this: InstanceHost, credential: unknown, bucket: string, service?: string, sdk?: string): Promise<void>;
                executeQuery?(this: ICloud, credential: unknown, data: CloudDatabase, cacheKey?: string): Promise<PlainObject[]>;
            }

            interface FinalizeResult {
                compressed: ExternalAsset[];
            }

            type ServiceHost<T> = (this: InstanceHost, credential: unknown, service?: string, sdk?: string) => T;
            type UploadHost = ServiceHost<UploadCallback>;
            type DownloadHost = ServiceHost<DownloadCallback>;
            type UploadCallback = (data: UploadData, success: (value: string) => void) => Promise<void>;
            type DownloadCallback = (data: DownloadData, success: (value: Null<Buffer | string>) => void) => Promise<void>;
        }

        interface InstallData<T, U> {
            instance: T;
            constructor: U;
            params: unknown[];
        }

        interface DocumentData {
            document?: string | string[];
        }

        interface FileData {
            file: ExternalAsset;
            mimeType?: string | false;
        }

        interface FileOutput {
            pathname: string;
            localUri: string;
        }

        enum LOG_TYPE {
            UNKNOWN = 0,
            SYSTEM = 1,
            NODE = 2,
            PROCESS = 4,
            COMPRESS = 8,
            WATCH = 16,
            CLOUD_STORAGE = 32,
            CLOUD_DATABASE = 64,
            TIME_ELAPSED = 128
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
        isFileHTTP(value: string): boolean;
        isFileUNC(value: string): boolean;
        isDirectoryUNC(value: string): boolean;
        isUUID(value: string): boolean;
        getResponseError(hint: string, message: Error | string): ResponseData;
        resolveUri(value: string): string;
        resolvePath(value: string, href: string): string;
    }

    interface ICompress extends IModule {
        gzipLevel: number;
        brotliQuality: number;
        tinifyApiKey: string;
        compressorProxy: ObjectMap<CompressTryFileMethod>;
        register(format: string, callback: CompressTryFileMethod): void;
        createWriteStreamAsGzip(source: string, localUri: string, level?: number): WriteStream;
        createWriteStreamAsBrotli(source: string, localUri: string, quality?: number, mimeType?: string): WriteStream;
        findFormat(compress: Undef<CompressFormat[]>, format: string): Undef<CompressFormat>;
        withinSizeRange(localUri: string, value: Undef<string>): boolean;
        tryFile: CompressTryFileMethod;
        tryImage(localUri: string, data: CompressFormat, callback: CompressTryImageCallback): void;
    }

    interface IImage extends IModule {
        parseMethod(value: string): Undef<string[]>;
        parseResize(value: string): Undef<ResizeData>;
        parseCrop(value: string): Undef<CropData>;
        parseRotate(value: string): Undef<RotateData>;
        parseQuality(value: string): Undef<QualityData>;
        parseOpacity(value: string): number;
    }

    interface ImageConstructor extends ModuleConstructor {
        resolveMime(this: IFileManager, data: FileData): Promise<boolean>;
        using(this: IFileManager, data: FileData, command: string, callback?: FileManagerFinalizeImageMethod): void;
        new(): IImage;
    }

    const Image: ImageConstructor;

    class ImageHandler<T> {
        instance: T;
        command: string
        resizeData?: ResizeData;
        cropData?: CropData;
        rotateData?: RotateData;
        qualityData?: QualityData;
        opacityValue: number;
        errorHandler?: (err: Error) => void;
        method(): void;
        resize(): void;
        crop(): void;
        opacity(): void;
        quality(): void;
        rotate(initialize?: FileManagerPerformAsyncTaskCallback, callback?: FileManagerCompleteAsyncTaskCallback): void;
        write(output: string, startTime?: number, callback?: FileManagerFinalizeImageMethod): void;
        finalize(output: string, callback: (result: string) => void): void;
        constructor(instance: T, data: FileData, command: string, finalAs?: string);
    }

    interface ITask extends IModule {
        module: ExtendedSettings.DocumentModule;
        readonly taskName: string;
        execute?(manager: IFileManager, task: PlainObject, callback: (value?: unknown) => void): void;
    }

    interface TaskConstructor extends ModuleConstructor {
        using(this: IFileManager, task: ITask, assets: ExternalAsset[], beforeStage?: boolean): Promise<void>;
        new(module: ExtendedSettings.DocumentModule): ITask;
    }

    const Task: TaskConstructor;

    interface ICloud extends IModule {
        settings: ExtendedSettings.CloudModule;
        database: CloudDatabase[];
        compressFormat: Set<string>;
        cacheExpires: number;
        setObjectKeys(assets: ExternalAsset[]): void;
        createBucket(service: string, credential: unknown, bucket: string, publicRead?: boolean): Promise<boolean>;
        deleteObjects(service: string, credential: unknown, bucket: string): Promise<void>;
        downloadObject(service: string, credential: unknown, bucket: string, download: CloudStorageDownload, callback: (value: Null<Buffer | string>) => void, bucketGroup?: string): Promise<void>;
        getStorage(action: CloudFunctions, data: Undef<CloudStorage[]>): Undef<CloudStorage>;
        hasStorage(action: CloudFunctions, storage: CloudStorage): CloudStorageUpload | false;
        getDatabaseRows(data: CloudDatabase, cacheKey?: string): Promise<PlainObject[]>;
        getDatabaseResult(service: string, credential: unknown, queryString: string, cacheKey?: string): Undef<any[]>;
        setDatabaseResult(service: string, credential: unknown, queryString: string, result: any[], cacheKey?: string): void;
        hasCredential(feature: CloudFeatures, data: CloudService): boolean;
        getCredential(data: CloudService): PlainObject;
        getUploadHandler(service: string, credential: unknown): Internal.Cloud.UploadCallback;
        getDownloadHandler(service: string, credential: unknown): Internal.Cloud.DownloadCallback;
    }

    interface CloudConstructor extends ModuleConstructor {
        finalize(this: IFileManager, cloud: ICloud): Promise<Internal.Cloud.FinalizeResult>;
        uploadAsset(this: IFileManager, cloud: ICloud, state: FinalizeState, file: ExternalAsset, mimeType?: string, uploadDocument?: boolean): Promise<void>;
        new(settings: ExtendedSettings.CloudModule): ICloud;
    }

    const Cloud: CloudConstructor;

    interface IDocument extends IModule {
        module: ExtendedSettings.DocumentModule;
        documentName: string;
        internalAssignUUID: string;
        templateMap?: StandardMap;
        findPluginData(type: string, name: string, settings: ObjectMap<StandardMap>): Internal.Document.PluginConfig;
        loadOptions(value: ConfigOrTransformer | string): Undef<ConfigOrTransformer>;
        loadConfig(value: string): Undef<StandardMap | string>;
        transform(type: string, format: string, value: string, input?: SourceMapInput): Promise<Void<[string, Undef<Map<string, SourceMapOutput>>]>>;
        formatContent?(manager: IFileManager, file: ExternalAsset, content: string): Promise<[string, boolean]>;
        imageQueue?: FileManagerQueueImageMethod;
        imageFinalize?: FileManagerFinalizeImageMethod<boolean>;
        cloudInit?(state: FinalizeState): void;
        cloudObject?(state: FinalizeState, file: ExternalAsset): boolean;
        cloudUpload?(state: FinalizeState, file: ExternalAsset, url: string, active: boolean): Promise<boolean>;
        cloudFinalize?(state: FinalizeState): Promise<void>;
    }

    interface DocumentConstructor extends ModuleConstructor {
        init(this: IFileManager, instance: IDocument): boolean;
        using(this: IFileManager, instance: IDocument, file: ExternalAsset): Promise<void>;
        finalize(this: IFileManager, instance: IDocument, assets: ExternalAsset[]): void;
        new(body: RequestBody, module: ExtendedSettings.DocumentModule, ...args: unknown[]): IDocument;
    }

    const Document: DocumentConstructor;

    interface IWatch extends IModule {
        Node: INode;
        interval: number;
        whenModified?: (assets: ExternalAsset[]) => void;
        start(assets: ExternalAsset[], permission?: IPermission): void;
    }

    interface WatchConstructor extends ModuleConstructor {
        new(node: INode, interval?: number): IWatch;
    }

    const Watch: WatchConstructor;

    interface IPermission {
        hasDiskRead(): boolean;
        hasDiskWrite(): boolean;
        hasUNCRead(): boolean;
        hasUNCWrite(): boolean;
    }

    interface PermissionConstructor {
        new(settings?: PermissionSettings): IFileManager;
    }

    const Permission: PermissionConstructor;

    interface IFileManager extends IModule {
        delayed: number;
        cleared: boolean;
        Document: Internal.InstallData<IDocument, DocumentConstructor>[];
        Task: Internal.InstallData<ITask, TaskConstructor>[];
        Cloud: Null<ICloud>;
        Watch: Null<IWatch>;
        Image: Null<ImageConstructor>;
        Compress: Null<ICompress>;
        readonly body: RequestBody;
        readonly files: Set<string>;
        readonly filesQueued: Set<string>;
        readonly filesToRemove: Set<string>;
        readonly filesToCompare: Map<ExternalAsset, string[]>;
        readonly contentToAppend: Map<string, string[]>;
        readonly emptyDir: Set<string>;
        readonly assets: ExternalAsset[];
        readonly documentAssets: ExternalAsset[];
        readonly taskAssets: ExternalAsset[];
        readonly postFinalize: FunctionType<void>;
        readonly baseDirectory: string;
        install(name: string, ...params: unknown[]): void;
        add(value: string): void;
        delete(value: string, emptyDir?: boolean): void;
        has(value: Undef<string>): value is string;
        replace(file: ExternalAsset, replaceWith: string, mimeType?: string): void;
        performAsyncTask: FileManagerPerformAsyncTaskCallback;
        removeAsyncTask(): void;
        completeAsyncTask: FileManagerCompleteAsyncTaskCallback;
        performFinalize(): void;
        setLocalUri(file: ExternalAsset): Internal.FileOutput;
        writeLocalUri(file: ExternalAsset): boolean;
        getRelativeUri(file: ExternalAsset, filename?: string): string;
        assignUUID(data: Internal.DocumentData, attr: string, target?: any): Undef<string>;
        findAsset(uri: string): Undef<ExternalAsset>;
        removeCwd(value: Undef<string>): string;
        getUTF8String(file: ExternalAsset, localUri?: string): string;
        appendContent(file: ExternalAsset, localUri: string, content: string, bundleIndex?: number): Promise<string>;
        getTrailingContent(file: ExternalAsset): Undef<string>;
        getBundleContent(localUri: string): Undef<string>;
        createSourceMap(file: ExternalAsset, sourcesContent: string): SourceMapInput;
        writeSourceMap(file: ExternalAsset, output: [string, Undef<Map<string, SourceMapOutput>>], modified?: boolean): void;
        compressFile(file: ExternalAsset): Promise<unknown>;
        queueImage: FileManagerQueueImageMethod;
        finalizeImage: FileManagerFinalizeImageMethod;
        finalizeAsset(data: FileData, parent?: ExternalAsset): Promise<void>;
        processAssets(emptyDir?: boolean): void;
        finalize(): Promise<void>;
    }

    interface FileManagerConstructor extends ModuleConstructor {
        getPermission(settings?: PermissionSettings): IPermission;
        hasPermission(dirname: string, permission: IPermission, res?: Response): boolean;
        moduleNode(): INode;
        moduleCompress(): ICompress;
        new(baseDirectory: string, body: RequestBody, postFinalize?: FunctionType<void>, settings?: PermissionSettings): IFileManager;
    }

    const FileManager: FileManagerConstructor;

    interface IModule {
        logType: typeof Internal.LOG_TYPE;
        tempDir: string;
        readonly major: number;
        readonly minor: number;
        readonly patch: number;
        supported(major: number, minor: number, patch?: number): boolean;
        parseFunction(value: string): Null<FunctionType<string>>;
        joinPosix(...paths: Undef<string>[]): string;
        getTempDir(subDir?: boolean, filename?: string): string;
        formatMessage: ModuleFormatMessageMethod;
        formatFail(type: Internal.LOG_TYPE, title: string, value: string | [string, string], message?: unknown): void;
        writeFail: ModuleWriteFailMethod;
        writeTimeElapsed(title: string, value: string, time: number, options?: LogMessageOptions): void;
        writeMessage(title: string, value: string, message?: unknown, options?: LogMessageOptions): void;
    }

    interface ModuleConstructor {
        formatMessage: ModuleFormatMessageMethod;
        allSettled<T>(values: readonly (T | PromiseLike<T>)[], rejected?: string | [string, string]): Promise<PromiseSettledResult<T>[]>;
        loadSettings(value: Settings): void;
        getFileSize(localUri: string): number;
        toPosix(value: string, filename?: string): string;
        renameExt(value: string, ext: string): string;
        isLocalPath(value: string): string;
        fromSameOrigin(value: string, other: string): boolean;
        new(): IModule;
    }

    const Module: ModuleConstructor;

    interface PermissionSettings {
        disk_read?: BoolString;
        disk_write?: BoolString;
        unc_read?: BoolString;
        unc_write?: BoolString;
    }

    interface Settings extends PermissionSettings {
        apiVersion?: string;
        compress?: ExtendedSettings.CompressModule;
        image?: ExtendedSettings.ImageModule;
        document?: ObjectMap<ExtendedSettings.DocumentModule>;
        task?: ObjectMap<ExtendedSettings.TaskModule>;
        watch?: ExtendedSettings.WatchModule;
        cloud?: ExtendedSettings.CloudModule;
        logger?: ExtendedSettings.LoggerModule;
    }

    namespace ExtendedSettings {
        interface HandlerModule {
            handler?: string;
            settings?: PlainObject;
        }

        interface DocumentModule extends HandlerModule {
            eval_function?: boolean;
            eval_template?: boolean;
        }

        interface TaskModule extends HandlerModule {}

        interface ImageModule extends HandlerModule {}

        interface CompressModule {
            gzip_level?: NumString;
            brotli_quality?: NumString;
            tinypng_api_key?: string;
        }

        interface CloudModule {
            cache?: Partial<Internal.Cloud.CacheTimeout>;
            aws?: ObjectMap<StringMap>;
            azure?: ObjectMap<StringMap>;
            gcloud?: ObjectMap<StringMap>;
            ibm?: ObjectMap<StringMap>;
            oci?: ObjectMap<StringMap>;
        }

        interface WatchModule {
            interval?: number;
        }

        interface LoggerModule {
            unknown?: boolean;
            system?: boolean;
            node?: boolean;
            process?: boolean;
            compress?: boolean;
            watch?: boolean;
            cloud_storage?: boolean;
            cloud_database?: boolean;
            time_elapsed?: boolean;
        }
    }

    interface RequestBody extends RequestData, chrome.RequestData {
        assets: ExternalAsset[];
    }

    interface ExternalAsset extends FileAsset, BundleAction {
        localUri?: string;
        relativeUri?: string;
        cloudUri?: string;
        buffer?: Buffer;
        sourceUTF8?: string;
        originalName?: string;
        transforms?: string[];
        etag?: string;
        invalid?: boolean;
    }
}

export = functions;
export as namespace functions;