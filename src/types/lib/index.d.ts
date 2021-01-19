/// <reference path="type.d.ts" />

/* eslint no-shadow: "off" */

import type { CloudDatabase, CloudService, CloudStorage, CloudStorageDownload, CloudStorageUpload, CompressFormat, ResponseData } from './squared';

import type { ExternalAsset, FileData, FileOutput } from './asset';
import type { CloudFeatures, CloudFunctions, FinalizeResult } from './cloud';
import type { CompressTryFileMethod, CompressTryImageCallback } from './compress';
import type { ConfigOrTransformer, DocumentData, PluginConfig, SourceMapInput, SourceMapOptions, SourceMapOutput, TransformOutput, TransformResult } from './document';
import type { CompleteAsyncTaskCallback, FinalizeImageCallback, InstallData, PerformAsyncTaskMethod, QueueImageMethod } from './filemanager';
import type { CropData, QualityData, ResizeData, RotateData } from './image';
import type { CloudModule, DocumentModule } from './module';
import type { LOG_TYPE, LogMessageOptions, LogValue, ModuleFormatMessageMethod, ModuleWriteFailMethod } from './logger';
import type { PermissionSettings, RequestBody, Settings } from './node';

import type { WriteStream } from 'fs';

declare namespace functions {
    interface ICompress extends IModule {
        gzipLevel: number;
        brotliQuality: number;
        compressorProxy: ObjectMap<CompressTryFileMethod>;
        chunkSize?: number;
        register(format: string, callback: CompressTryFileMethod): void;
        createWriteStreamAsGzip(source: string, uri: string, level?: number): WriteStream;
        createWriteStreamAsBrotli(source: string, uri: string, quality?: number, mimeType?: string): WriteStream;
        tryFile: CompressTryFileMethod;
        tryImage(uri: string, data: CompressFormat, callback: CompressTryImageCallback): void;
    }

    interface IImage extends IModule {
        readonly moduleName: string;
        parseMethod(value: string): Undef<string[]>;
        parseResize(value: string): Undef<ResizeData>;
        parseCrop(value: string): Undef<CropData>;
        parseRotate(value: string): Undef<RotateData>;
        parseQuality(value: string): Undef<QualityData>;
        parseOpacity(value: string): number;
    }

    interface ImageConstructor extends ModuleConstructor {
        resolveMime(this: IFileManager, data: FileData): Promise<boolean>;
        using(this: IFileManager, data: FileData, command: string, callback?: FinalizeImageCallback): void;
        clamp(value: Undef<string>, min?: number, max?: number): number;
        new(): IImage;
    }

    const Image: ImageConstructor;

    interface ITask extends IModule {
        module: DocumentModule;
        execute?(manager: IFileManager, task: PlainObject, callback: (value?: unknown) => void): void;
    }

    interface TaskConstructor extends ModuleConstructor {
        using(this: IFileManager, task: ITask, assets: ExternalAsset[], beforeStage?: boolean): Promise<void>;
        new(module: DocumentModule): ITask;
    }

    const Task: TaskConstructor;

    interface ICloud extends IModule {
        settings: CloudModule;
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
        getUploadHandler(service: string, credential: unknown): FunctionType<Promise<void>>;
        getDownloadHandler(service: string, credential: unknown): FunctionType<Promise<void>>;
    }

    interface CloudConstructor extends ModuleConstructor {
        finalize<T = IFileManager, U = ICloud>(this: T, cloud: U): Promise<FinalizeResult>;
        uploadAsset<T = IFileManager, U = ICloud>(this: T, cloud: U, state: ScopeOrigin<T, U>, file: ExternalAsset, mimeType?: string, uploadDocument?: boolean): Promise<void>;
        new(settings: CloudModule): ICloud;
    }

    const Cloud: CloudConstructor;

    interface ICloudServiceClient {
        validateStorage?(credential: PlainObject, data?: CloudService): boolean;
        validateDatabase?(credential: PlainObject, data?: CloudService): boolean;
        createStorageClient?<T>(this: IModule, credential: unknown, service?: string): T;
        createDatabaseClient?<T>(this: IModule, credential: unknown, data?: CloudService): T;
        createBucket?(this: IModule, credential: unknown, bucket: string, publicRead?: boolean, service?: string, sdk?: string): Promise<boolean>;
        deleteObjects?(this: IModule, credential: unknown, bucket: string, service?: string, sdk?: string): Promise<void>;
        executeQuery?(this: ICloud, credential: unknown, data: CloudDatabase, cacheKey?: string): Promise<PlainObject[]>;
    }

    interface IDocument<T = IFileManager, U = ICloud> extends IModule {
        module: DocumentModule;
        templateMap?: StandardMap;
        readonly moduleName: string;
        readonly internalAssignUUID: string;
        findConfig(settings: StandardMap, name: string, type?: string): PluginConfig;
        loadConfig(data: StandardMap, name: string): Optional<ConfigOrTransformer>;
        transform(type: string, code: string, format: string, options?: TransformOutput): Promise<Void<TransformResult>>;
        formatContent?(manager: IFileManager, file: ExternalAsset, content: string): Promise<string>;
        imageQueue?: QueueImageMethod;
        imageFinalize?: FinalizeImageCallback<boolean>;
        cloudInit?(state: ScopeOrigin<T, U>): void;
        cloudObject?(state: ScopeOrigin<T, U>, file: ExternalAsset): boolean;
        cloudUpload?(state: ScopeOrigin<T, U>, file: ExternalAsset, url: string, active: boolean): Promise<boolean>;
        cloudFinalize?(state: ScopeOrigin<T, U>): Promise<void>;
    }

    interface DocumentConstructor extends ModuleConstructor {
        init(this: IFileManager, instance: IDocument, body: RequestBody): boolean;
        using(this: IFileManager, instance: IDocument, file: ExternalAsset): Promise<void>;
        finalize(this: IFileManager, instance: IDocument, assets: ExternalAsset[]): Promise<void>;
        createSourceMap(code: string, file?: ExternalAsset): SourceMapInput;
        writeSourceMap(localUri: string, sourceMap: SourceMapOutput, options?: SourceMapOptions): Undef<string>;
        new(module: DocumentModule, templateMap?: Undef<StandardMap>, ...args: unknown[]): IDocument;
    }

    const Document: DocumentConstructor;

    interface IWatch extends IModule {
        interval: number;
        whenModified?: (assets: ExternalAsset[]) => void;
        start(assets: ExternalAsset[], permission?: IPermission): void;
    }

    interface WatchConstructor extends ModuleConstructor {
        new(interval?: number): IWatch;
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
        Document: InstallData<IDocument, DocumentConstructor>[];
        Task: InstallData<ITask, TaskConstructor>[];
        Cloud: Null<ICloud>;
        Watch: Null<IWatch>;
        Image: Null<Map<string, ImageConstructor>>;
        Compress: Null<ICompress>;
        readonly baseDirectory: string;
        readonly body: RequestBody;
        readonly assets: ExternalAsset[];
        readonly documentAssets: ExternalAsset[];
        readonly taskAssets: ExternalAsset[];
        readonly files: Set<string>;
        readonly filesQueued: Set<string>;
        readonly filesToRemove: Set<string>;
        readonly filesToCompare: Map<ExternalAsset, string[]>;
        readonly contentToAppend: Map<string, string[]>;
        readonly emptyDir: Set<string>;
        readonly permission: IPermission;
        readonly postFinalize?: (errors: string[]) => void;
        install(name: string, ...params: unknown[]): void;
        add(value: string, parent?: ExternalAsset): void;
        delete(value: string, emptyDir?: boolean): void;
        has(value: Undef<string>): value is string;
        replace(file: ExternalAsset, replaceWith: string, mimeType?: string): void;
        performAsyncTask: PerformAsyncTaskMethod;
        removeAsyncTask(): void;
        completeAsyncTask: CompleteAsyncTaskCallback;
        performFinalize(): void;
        setLocalUri(file: ExternalAsset): FileOutput;
        getRelativeUri(file: ExternalAsset, filename?: string): string;
        assignUUID(data: DocumentData, attr: string, target?: any): Undef<string>;
        findAsset(uri: string): Undef<ExternalAsset>;
        removeCwd(value: Undef<string>): string;
        getUTF8String(file: ExternalAsset, localUri?: string): string;
        appendContent(file: ExternalAsset, localUri: string, content: string, bundleIndex?: number): Promise<string>;
        getTrailingContent(file: ExternalAsset): Undef<string>;
        getBundleContent(localUri: string): Undef<string>;
        writeBuffer(file: ExternalAsset): Null<Buffer>;
        compressFile(file: ExternalAsset): Promise<unknown>;
        queueImage: QueueImageMethod;
        finalizeImage: FinalizeImageCallback;
        finalizeAsset(data: FileData, parent?: ExternalAsset): Promise<void>;
        processAssets(emptyDir?: boolean): void;
        finalize(): Promise<void>;
    }

    interface FileManagerConstructor extends ModuleConstructor {
        getPermission(settings?: PermissionSettings): IPermission;
        hasPermission(dirname: string, permission: IPermission): true | ResponseData;
        moduleCompress(): ICompress;
        new(baseDirectory: string, body: RequestBody, postFinalize?: (errors: string[]) => void, settings?: PermissionSettings): IFileManager;
    }

    const FileManager: FileManagerConstructor;

    interface IModule {
        logType: typeof LOG_TYPE;
        tempDir: string;
        readonly major: number;
        readonly minor: number;
        readonly patch: number;
        readonly errors: string[];
        readonly moduleName?: string;
        supported(major: number, minor: number, patch?: number): boolean;
        getTempDir(uuidDir?: boolean, filename?: string): string;
        formatMessage: ModuleFormatMessageMethod;
        formatFail(type: LOG_TYPE, title: string, value: LogValue, message?: Null<Error>): void;
        writeFail: ModuleWriteFailMethod;
        writeTimeElapsed(title: string, value: string, time: number, options?: LogMessageOptions): void;
    }

    interface ModuleConstructor {
        LOG_TYPE: typeof LOG_TYPE;
        LOG_STYLE_FAIL: LogMessageOptions;
        formatMessage: ModuleFormatMessageMethod;
        writeFail: ModuleWriteFailMethod;
        parseFunction(value: string, name?: string): Undef<FunctionType<string>>;
        toPosix(value: string, filename?: string): string;
        renameExt(value: string, ext: string): string;
        isLocalPath(value: string): string;
        hasSameOrigin(value: string, other: string): boolean;
        isFileHTTP(value: string): boolean;
        isFileUNC(value: string): boolean;
        isDirectoryUNC(value: string): boolean;
        isUUID(value: string): boolean;
        resolveUri(value: string): string;
        resolvePath(value: string, href: string): string;
        joinPosix(...paths: Undef<string>[]): string;
        getFileSize(localUri: string): number;
        loadSettings(value: Settings): void;
        responseError(message: Error | string, hint?: string): ResponseData;
        allSettled<T>(values: readonly (T | PromiseLike<T>)[], rejected?: string | [string, string]): Promise<PromiseSettledResult<T>[]>;
        new(): IModule;
    }

    const Module: ModuleConstructor;

    interface ScopeOrigin<T = IModule, U = IModule> {
        host: T;
        instance: U;
    }

    class ImageHandler<T, U> implements ScopeOrigin<T, U> {
        host: T;
        instance: U;
        command: string
        resizeData?: ResizeData;
        cropData?: CropData;
        rotateData?: RotateData;
        qualityData?: QualityData;
        opacityValue: number;
        method(): void;
        resize(): void;
        crop(): void;
        opacity(): void;
        quality(): void;
        rotate(performAsyncTask?: PerformAsyncTaskMethod, callback?: CompleteAsyncTaskCallback): void;
        write(output: string, startTime?: number, callback?: FinalizeImageCallback): void;
        finalize(output: string, callback: (err: Null<Error>, result: string) => void): void;
        constructor(host: T, instance: U, data: FileData, command: string, finalAs?: string);
    }
}

export = functions;
export as namespace functions;