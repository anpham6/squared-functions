/// <reference path="type.d.ts" />
/// <reference path="object.d.ts" />
/// <reference path="internal.d.ts" />

/* eslint no-shadow: "off" */

import type { CompressFormat, CompressLevel, DataSource, LocationUri, ViewEngine, XmlTagNode } from './squared';

import type { ExternalAsset, FileData, FileOutput, OutputData } from './asset';
import type { CloudDatabase, CloudFeatures, CloudFunctions, CloudService, CloudStorage, CloudStorageDownload, CloudStorageUpload } from './cloud';
import type { CompressTryFileMethod } from './compress';
import type { ConfigOrTransformer, PluginConfig, SourceInput, SourceMapInput, SourceMapOptions, SourceMapOutput, TransformOutput, TransformResult } from './document';
import type { CompleteAsyncTaskCallback, HttpRequestBuffer, HttpRequestSettings, InstallData, PerformAsyncTaskMethod, PostFinalizeCallback } from './filemanager';
import type { HttpProxyData, HttpRequest, HttpRequestClient, HttpVersionSupport } from './http';
import type { CropData, QualityData, ResizeData, RotateData } from './image';
import type { LOG_TYPE, LogMessageOptions, LogTimeProcessOptions, LogValue, ModuleFormatMessageMethod, ModuleWriteFailMethod } from './logger';
import type { AllSettledOptions, CloudModule, DocumentModule, TaskModule } from './module';
import type { RequestBody, Settings } from './node';
import type { FileWatch } from './watch';

import type { PathLike, WriteStream } from 'fs';
import type { Readable, Writable } from 'stream';
import type { FileTypeResult } from 'file-type';

import type * as bytes from 'bytes';

type ModuleSupportedMethod = (major: number, minor?: number, patch?: number, lts?: boolean) => boolean;

declare namespace functions {
    interface IHost<T = IFileManager> {
        host?: T;
    }

    interface IScopeOrigin<T = IModule, U = IModule> {
        host?: T;
        instance: U;
    }

    interface ICompress extends IModule, IHost {
        level: ObjectMap<number>;
        compressors: ObjectMap<CompressTryFileMethod>;
        chunkSize?: number;
        register(format: string, callback: CompressTryFileMethod): void;
        getReadable(file: string | Buffer): Readable;
        createWriteStreamAsGzip(file: string | Buffer, output: string, options?: CompressLevel): WriteStream;
        createWriteStreamAsBrotli(file: string | Buffer, output: string, options?: CompressLevel): WriteStream;
        tryFile: CompressTryFileMethod;
        tryImage(uri: string, data: CompressFormat, callback?: CompleteAsyncTaskCallback<Buffer | Uint8Array>): void;
    }

    interface IImage extends IModule, IHost {
        resizeData?: ResizeData;
        cropData?: CropData;
        rotateData?: RotateData;
        qualityData?: QualityData;
        opacityValue: number;
        readonly moduleName: string;
        reset(): void;
        setCommand(value: string): void;
        getCommand(): string;
        parseMethod(value: string): Undef<[string, unknown[]?][]>;
        parseResize(value: string): Undef<ResizeData>;
        parseCrop(value: string): Undef<CropData>;
        parseRotate(value: string): Undef<RotateData>;
        parseQuality(value: string): Undef<QualityData>;
        parseOpacity(value: string): number;
    }

    interface ImageConstructor extends ModuleConstructor {
        using(this: IFileManager, data: FileData, command: string): void;
        transform(uri: string, command: string, mimeType?: string, tempFile?: boolean): Promise<Null<Buffer> | string>;
        parseFormat(command: string): string[];
        clamp(value: Undef<string>, min?: number, max?: number): number;
        new(): IImage;
    }

    interface ITask extends IModule, IHost {
        module: DocumentModule;
        execute?(manager: IFileManager, task: PlainObject, callback: (value?: unknown) => void): void;
    }

    interface TaskConstructor extends ModuleConstructor {
        using(this: IFileManager, task: ITask, assets: ExternalAsset[], beforeStage?: boolean): Promise<void>;
        new(module: DocumentModule, ...args: unknown[]): ITask;
    }

    interface ICloud extends IModule, IHost {
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
        getDatabaseRows(data: CloudDatabase, cacheKey?: string): Promise<unknown[]>;
        getDatabaseResult(service: string, credential: unknown, queryString: string, cacheKey?: string): Undef<unknown[]>;
        setDatabaseResult(service: string, credential: unknown, queryString: string, result: unknown[], cacheKey?: string): void;
        hasCredential(feature: CloudFeatures, data: CloudService): boolean;
        getCredential(data: CloudService): PlainObject;
        getUploadHandler(service: string, credential: unknown): FunctionType<Promise<void>>;
        getDownloadHandler(service: string, credential: unknown): FunctionType<Promise<void>>;
        resolveService(service: string, folder?: string): string;
    }

    interface CloudConstructor extends ModuleConstructor {
        finalize<T = IFileManager, U = ICloud>(this: T, instance: U): Promise<void>;
        uploadAsset<T = IFileManager, U = ICloud>(this: T, instance: U, state: IScopeOrigin<T, U>, file: ExternalAsset, mimeType?: string, uploadDocument?: boolean): Promise<void>;
        new(settings: CloudModule): ICloud;
    }

    interface ICloudServiceClient {
        validateStorage?(credential: PlainObject, data?: CloudService): boolean;
        validateDatabase?(credential: PlainObject, data?: CloudService): boolean;
        createStorageClient?<T>(this: IModule, credential: unknown, service?: string): T;
        createDatabaseClient?<T>(this: IModule, credential: unknown, data?: CloudService): T;
        createBucket?(this: IModule, credential: unknown, bucket: string, publicRead?: boolean, service?: string, sdk?: string): Promise<boolean>;
        deleteObjects?(this: IModule, credential: unknown, bucket: string, service?: string, sdk?: string): Promise<void>;
        executeQuery?(this: ICloud, credential: unknown, data: CloudDatabase, cacheKey?: string): Promise<unknown[]>;
    }

    interface IDocument<T = IFileManager, U = ICloud> extends IModule, IHost<T> {
        module: DocumentModule;
        moduleName: string;
        assets: ExternalAsset[];
        imports?: StringMap;
        configData?: StandardMap;
        init(assets: ExternalAsset[], body: RequestBody): void;
        findConfig(settings: StandardMap, name: string, type?: string): PluginConfig;
        loadConfig(data: StandardMap, name: string): Optional<ConfigOrTransformer>;
        parseTemplate(viewEngine: ViewEngine | string, template: string, data: PlainObject[]): Promise<Null<string>>;
        transform(type: string, code: string, format: string, options?: TransformOutput): Promise<Void<TransformResult>>;
        setLocalUri?(file: Partial<LocationUri>): void;
        resolveUri?(file: ExternalAsset, source: string): string;
        addCopy?(data: FileData, saveAs: string, replace?: boolean): Undef<string>;
        writeImage?(data: OutputData): boolean;
        cloudInit?(state: IScopeOrigin<T, U>): void;
        cloudObject?(state: IScopeOrigin<T, U>, file: ExternalAsset): boolean;
        cloudUpload?(state: IScopeOrigin<T, U>, file: ExternalAsset, url: string, active: boolean): Promise<boolean>;
        cloudFinalize?(state: IScopeOrigin<T, U>): Promise<void>;
        get xmlNodes(): XmlTagNode[];
        get dataSource(): DataSource[];
    }

    interface DocumentConstructor extends ModuleConstructor {
        using(this: IFileManager, instance: IDocument, file: ExternalAsset): Promise<void>;
        finalize(this: IFileManager, instance: IDocument): Promise<void>;
        cleanup(this: IFileManager, instance: IDocument): Promise<void>;
        createSourceMap(code: string): SourceMapInput;
        writeSourceMap(uri: string, sourceMap: SourceMapOutput, options?: SourceMapOptions, emptySources?: boolean): Undef<string>;
        removeSourceMappingURL(value: string): [string, string?];
        createSourceFilesMethod(this: IFileManager, instance: IDocument, file: ExternalAsset, source?: string): SourceInput;
        sanitizeAssets?(assets: ExternalAsset[], exclusions?: ExternalAsset[]): void;
        new(module: DocumentModule, ...args: unknown[]): IDocument;
    }

    interface IWatch extends IModule, IHost {
        interval: number;
        port: number;
        securePort: number;
        whenModified?: (assets: ExternalAsset[], postFinalize?: FunctionType) => void;
        start(assets: ExternalAsset[], permission?: IPermission): void;
        modified(watch: FileWatch): void;
        setSSLKey(value: string): void;
        setSSLCert(value: string): void;
    }

    interface WatchConstructor extends ModuleConstructor {
        shutdown(): void;
        parseExpires(value: NumString, start?: number): number;
        hasLocalAccess(permission: IPermission, uri: unknown): boolean;
        new(interval?: number, port?: number, securePort?: number): IWatch;
    }

    interface IPermission {
        readonly diskRead: boolean;
        readonly diskWrite: boolean;
        readonly uncRead: boolean;
        readonly uncWrite: boolean;
        setDiskRead(pathname?: StringOfArray): void;
        setDiskWrite(pathname?: StringOfArray): void;
        setUNCRead(pathname?: StringOfArray): void;
        setUNCWrite(pathname?: StringOfArray): void;
        hasDiskRead(value: unknown): boolean;
        hasDiskWrite(value: unknown): boolean;
        hasUNCRead(value: unknown): boolean;
        hasUNCWrite(value: unknown): boolean;
    }

    interface PermissionConstructor {
        new(): IPermission;
    }

    interface IFileManager extends IModule {
        delayed: number;
        cleared: boolean;
        httpVersion: HttpVersionSupport;
        httpProxy: Null<HttpProxyData>;
        useAcceptEncoding: boolean;
        keepAliveTimeout: number;
        cacheHttpRequest: boolean;
        cacheHttpRequestBuffer: HttpRequestBuffer;
        Document: InstallData<IDocument, DocumentConstructor>[];
        Task: InstallData<ITask, TaskConstructor>[];
        Image: Null<Map<string, ImageConstructor>>;
        Cloud: Null<ICloud>;
        Watch: Null<IWatch>;
        Compress: Null<ICompress>;
        readonly startTime: number;
        readonly baseDirectory: string;
        readonly body: RequestBody;
        readonly assets: ExternalAsset[];
        readonly documentAssets: ExternalAsset[];
        readonly taskAssets: ExternalAsset[];
        readonly dataSourceItems: DataSource[];
        readonly files: Set<string>;
        readonly filesQueued: Set<string>;
        readonly filesToRemove: Set<string>;
        readonly filesToCompare: Map<ExternalAsset, string[]>;
        readonly contentToAppend: Map<string, string[]>;
        readonly contentToReplace: Map<string, string[]>;
        readonly subProcesses: Set<IModule>;
        readonly emptyDir: Set<string>;
        readonly permission: IPermission;
        readonly archiving: boolean;
        readonly postFinalize: Null<PostFinalizeCallback>;
        install(name: "cloud", module: CloudModule): Undef<ICloud>;
        install(name: "compress"): Undef<ICompress>;
        install(name: "document", target: DocumentConstructor, module: DocumentModule): Undef<IDocument>;
        install(name: "image", data: Map<string, ImageConstructor>): void;
        install(name: "task", target: TaskConstructor, module: TaskModule): Undef<ITask>;
        install(name: "watch", interval?: NumString, port?: NumString, securePort?: NumString): Undef<IWatch>;
        install(name: string, ...params: unknown[]): any;
        add(value: unknown, parent?: ExternalAsset): void;
        delete(value: unknown, emptyDir?: boolean): void;
        has(value: unknown): value is string;
        removeCwd(value: unknown): string;
        findAsset(value: unknown, instance?: IModule): Undef<ExternalAsset>;
        removeAsset(file: ExternalAsset): void;
        replace(file: ExternalAsset, replaceWith: string, mimeType?: string): void;
        performAsyncTask: PerformAsyncTaskMethod;
        removeAsyncTask(): void;
        completeAsyncTask: CompleteAsyncTaskCallback<string, ExternalAsset>;
        performFinalize(): void;
        hasDocument(instance: IModule, document: Undef<StringOfArray>): boolean;
        getDocumentAssets(instance: IModule): ExternalAsset[];
        getDataSourceItems(instance: IModule): DataSource[];
        setLocalUri(file: ExternalAsset): FileOutput;
        getLocalUri(data: FileData): string;
        getMimeType(data: FileData): Undef<string>;
        getRelativeUri(file: ExternalAsset, filename?: string): string;
        getUTF8String(file: ExternalAsset, uri?: string): string;
        setAssetContent(file: ExternalAsset, uri: string, content: string, index?: number, replacePattern?: string): string;
        getAssetContent(file: ExternalAsset, source?: string): Undef<string>;
        writeBuffer(file: ExternalAsset): Null<Buffer>;
        writeImage(document: StringOfArray, data: OutputData): boolean;
        compressFile(file: ExternalAsset, overwrite?: boolean): Promise<unknown>;
        addCopy(data: FileData, saveAs?: string, replace?: boolean): Undef<string>;
        findMime(data: FileData, rename?: boolean): Promise<string>;
        transformAsset(data: FileData, parent?: ExternalAsset): Promise<void>;
        createHttpRequest(url: string | URL, httpVersion?: HttpVersionSupport): HttpRequest;
        getHttpClient(uri: string, options?: Partial<HttpRequest>): HttpRequestClient;
        fetchBuffer(uri: string, options?: Partial<HttpRequest>): Promise<Null<Buffer>>;
        processAssets(emptyDir?: boolean): void;
        finalize(): Promise<void>;
    }

    interface FileManagerConstructor extends ModuleConstructor {
        moduleCompress(): ICompress;
        createPermission(): IPermission;
        resolveMime(data: Buffer | string): Promise<Undef<FileTypeResult>>;
        fromHttpStatusCode(value: NumString): string;
        cleanupStream(writable: Writable, uri?: string): void;
        resetHttpHost(version?: number): void;
        getHttpBufferSize(): number;
        clearHttpBuffer(percent?: number): void;
        settingsHttpRequest(options: HttpRequestSettings) : void;
        formatSize(value: string): number;
        formatSize(value: number, options?: bytes.BytesOptions): string;
        new(baseDirectory: string, body: RequestBody, postFinalize?: PostFinalizeCallback, archiving?: boolean): IFileManager;
    }

    interface IModule {
        logType: typeof LOG_TYPE;
        tempDir: string;
        moduleName: string;
        readonly major: number;
        readonly minor: number;
        readonly patch: number;
        readonly errors: string[];
        supported: ModuleSupportedMethod;
        getTempDir(uuidDir?: boolean, filename?: string): string;
        formatMessage: ModuleFormatMessageMethod;
        formatFail(type: LOG_TYPE, title: string, value: LogValue, message?: unknown): void;
        writeFail: ModuleWriteFailMethod;
        writeTimeProcess(title: string, value: string, time: number, options?: LogTimeProcessOptions): void;
        writeTimeElapsed(title: string, value: string, time: number, options?: LogMessageOptions): void;
        flushLog(): void;
    }

    interface ModuleConstructor {
        LOG_TYPE: typeof LOG_TYPE;
        LOG_STYLE_FAIL: LogMessageOptions;
        formatMessage: ModuleFormatMessageMethod;
        writeFail: ModuleWriteFailMethod;
        isObject<T = PlainObject>(value: unknown): value is T;
        isString(value: unknown): value is string;
        generateUUID(format?: string, dictionary?: string): string;
        escapePattern(value: unknown): string;
        asFunction<T = string>(value: string, sync?: boolean): Undef<FunctionType<Promise<T> | T>>;
        parseFunction<T = string>(value: string, name?: string, sync?: boolean): Undef<FunctionType<Promise<T> | T>>;
        toPosix(value: unknown, filename?: string): string;
        renameExt(value: string, ext: string): string;
        fromLocalPath(value: string): string;
        hasSameOrigin(value: string, other: string): boolean;
        hasSameStat(src: string, dest: string, keepEmpty?: boolean): boolean;
        hasSize(src: string): boolean;
        hasLogType(value: LOG_TYPE): boolean;
        isFileHTTP(value: string): boolean;
        isFileUNC(value: string): boolean;
        isPathUNC(value: string): boolean;
        isUUID(value: string): boolean;
        isErrorCode(err: Error, ...code: string[]): boolean;
        resolveUri(value: string): string;
        resolvePath(value: string, href: string): string;
        joinPath(...values: unknown[]): string;
        getFileSize(value: PathLike): number;
        mkdirSafe(value: string, skipCheck?: boolean): boolean;
        loadSettings(value: Settings): void;
        allSettled<T>(values: readonly (T | PromiseLike<T>)[], options?: AllSettledOptions): Promise<PromiseSettledResult<T>[]>;
        new(): IModule;
    }

    const Image: ImageConstructor;
    const Task: TaskConstructor;
    const Cloud: CloudConstructor;
    const Document: DocumentConstructor;
    const Watch: WatchConstructor;
    const Permission: PermissionConstructor;
    const FileManager: FileManagerConstructor;
    const Module: ModuleConstructor;
}

export = functions;