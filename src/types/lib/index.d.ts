/// <reference path="type.d.ts" />

/* eslint no-shadow: "off" */

import type { CompressFormat, CompressLevel, DataSource, LocationUri, ViewEngine, XmlTagNode } from './squared';

import type { ExternalAsset, FileData, FileOutput, OutputData } from './asset';
import type { CloudDatabase, CloudFeatures, CloudFunctions, CloudService, CloudStorage, CloudStorageDownload, CloudStorageUpload } from './cloud';
import type { CompressTryFileMethod, CompressTryImageCallback } from './compress';
import type { ConfigOrTransformer, PluginConfig, SourceMapInput, SourceMapOptions, SourceMapOutput, TransformOutput, TransformResult } from './document';
import type { CompleteAsyncTaskCallback, InstallData, PerformAsyncTaskMethod } from './filemanager';
import type { CropData, QualityData, ResizeData, RotateData } from './image';
import type { LOG_TYPE, LogMessageOptions, LogValue, ModuleFormatMessageMethod, ModuleWriteFailMethod } from './logger';
import type { CloudModule, DocumentModule } from './module';
import type { RequestBody, Settings } from './node';
import type { FileWatch } from './watch';

import type { PathLike, WriteStream } from 'fs';
import type { FileTypeResult } from 'file-type';

declare namespace functions {
    interface IScopeOrigin<T = IModule, U = IModule> {
        host?: T;
        instance: U;
    }

    interface ICompress extends IModule {
        level: ObjectMap<number>;
        compressors: ObjectMap<CompressTryFileMethod>;
        chunkSize?: number;
        register(format: string, callback: CompressTryFileMethod): void;
        createWriteStreamAsGzip(uri: string, output: string, options?: CompressLevel): WriteStream;
        createWriteStreamAsBrotli(uri: string, output: string, options?: CompressLevel): WriteStream;
        tryFile: CompressTryFileMethod;
        tryImage(uri: string, data: CompressFormat, callback?: CompressTryImageCallback): void;
    }

    interface IImage extends IModule {
        resizeData?: ResizeData;
        cropData?: CropData;
        rotateData?: RotateData;
        qualityData?: QualityData;
        opacityValue: number;
        readonly moduleName: string;
        reset(): void;
        setCommand(value: string): void;
        getCommand(): string;
        parseMethod(value: string): Undef<string[]>;
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

    interface ITask extends IModule {
        module: DocumentModule;
        execute?(manager: IFileManager, task: PlainObject, callback: (value?: unknown) => void): void;
    }

    interface TaskConstructor extends ModuleConstructor {
        using(this: IFileManager, task: ITask, assets: ExternalAsset[], beforeStage?: boolean): Promise<void>;
        new(module: DocumentModule, ...args: unknown[]): ITask;
    }

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

    interface IDocument<T = IFileManager, U = ICloud> extends IModule {
        module: DocumentModule;
        moduleName: string;
        assets: ExternalAsset[];
        configData?: StandardMap;
        init(assets: ExternalAsset[], body: RequestBody): void;
        findConfig(settings: StandardMap, name: string, type?: string): PluginConfig;
        loadConfig(data: StandardMap, name: string): Optional<ConfigOrTransformer>;
        parseTemplate(viewEngine: ViewEngine | string, template: string, data: PlainObject[]): Promise<Null<string>>;
        transform(type: string, code: string, format: string, options?: TransformOutput): Promise<Void<TransformResult>>;
        setLocalUri?(file: Partial<LocationUri>, manager?: IFileManager): void;
        formatContent?(file: ExternalAsset, content: string, manager?: IFileManager): Promise<string>;
        addCopy?(data: FileData, saveAs: string, replace?: boolean, manager?: IFileManager): Undef<string>;
        writeImage?(data: OutputData, manager?: IFileManager): boolean;
        cloudInit?(state: IScopeOrigin<T, U>): void;
        cloudObject?(state: IScopeOrigin<T, U>, file: ExternalAsset): boolean;
        cloudUpload?(state: IScopeOrigin<T, U>, file: ExternalAsset, url: string, active: boolean): Promise<boolean>;
        cloudFinalize?(state: IScopeOrigin<T, U>): Promise<void>;
    }

    interface DocumentConstructor extends ModuleConstructor {
        using(this: IFileManager, instance: IDocument, file: ExternalAsset): Promise<void>;
        finalize(this: IFileManager, instance: IDocument): Promise<void>;
        cleanup(this: IFileManager, instance: IDocument): Promise<void>;
        createSourceMap(code: string, file?: ExternalAsset): SourceMapInput;
        writeSourceMap(localUri: string, sourceMap: SourceMapOutput, options?: SourceMapOptions): Undef<string>;
        new(module: DocumentModule, ...args: unknown[]): IDocument;
    }

    interface IWatch extends IModule {
        interval: number;
        port: number;
        securePort: number;
        whenModified?: (assets: ExternalAsset[], postFinalize?: FunctionType<void>) => void;
        start(assets: ExternalAsset[], permission?: IPermission): void;
        modified(watch: FileWatch): void;
        setSSLKey(value: string): void;
        setSSLCert(value: string): void;
    }

    interface WatchConstructor extends ModuleConstructor {
        shutdown(): void;
        new(interval?: number, port?: number): IWatch;
    }

    interface IPermission {
        setDiskRead(): void;
        setDiskWrite(): void;
        setUNCRead(): void;
        setUNCWrite(): void;
        hasDiskRead(): boolean;
        hasDiskWrite(): boolean;
        hasUNCRead(): boolean;
        hasUNCWrite(): boolean;
    }

    interface PermissionConstructor {
        new(): IPermission;
    }

    interface IFileManager extends IModule {
        delayed: number;
        cleared: boolean;
        cacheHttpRequest: boolean;
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
        readonly emptyDir: Set<string>;
        readonly permission: IPermission;
        readonly archiving: boolean;
        readonly postFinalize?: (errors: string[]) => void;
        install(name: string, ...params: unknown[]): Undef<IModule>;
        add(value: string, parent?: ExternalAsset): void;
        delete(value: string, emptyDir?: boolean): void;
        has(value: Undef<string>): value is string;
        replace(file: ExternalAsset, replaceWith: string, mimeType?: string): void;
        removeAsset(file: ExternalAsset): void;
        performAsyncTask: PerformAsyncTaskMethod;
        removeAsyncTask(): void;
        completeAsyncTask: CompleteAsyncTaskCallback;
        performFinalize(): void;
        hasDocument(instance: IModule, document: Undef<StringOfArray>): boolean;
        getDocumentAssets(instance: IModule): ExternalAsset[];
        getDataSourceItems(instance: IModule): DataSource[];
        getElements(): XmlTagNode[];
        setLocalUri(file: ExternalAsset): FileOutput;
        getLocalUri(data: FileData): string;
        getMimeType(data: FileData): Undef<string>;
        getRelativeUri(file: ExternalAsset, filename?: string): string;
        findAsset(uri: string, instance?: IModule): Undef<ExternalAsset>;
        removeCwd(value: Undef<string>): string;
        getUTF8String(file: ExternalAsset, localUri?: string): string;
        setAssetContent(file: ExternalAsset, localUri: string, content: string, index?: number): Promise<string>;
        getAssetContent(file: ExternalAsset): Undef<string>;
        writeBuffer(file: ExternalAsset): Null<Buffer>;
        writeImage(document: StringOfArray, data: OutputData): boolean;
        compressFile(file: ExternalAsset, overwrite?: boolean): Promise<unknown>;
        addCopy(data: FileData, saveAs?: string, replace?: boolean): Undef<string>;
        findMime(data: FileData, rename?: boolean): Promise<string>;
        transformAsset(data: FileData, parent?: ExternalAsset): Promise<void>;
        processAssets(emptyDir?: boolean): void;
        finalize(): Promise<void>;
    }

    interface FileManagerConstructor extends ModuleConstructor {
        moduleCompress(): ICompress;
        resolveMime(data: Buffer | string): Promise<Undef<FileTypeResult>>;
        new(baseDirectory: string, body: RequestBody, postFinalize?: (errors: string[]) => void): IFileManager;
    }

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
        isObject<T = PlainObject>(value: unknown): value is T;
        escapePattern(value: string): string;
        parseFunction(value: string, name?: string, sync?: boolean): Undef<FunctionType<Promise<string> | string>>;
        toPosix(value: string, filename?: string): string;
        renameExt(value: string, ext: string): string;
        fromLocalPath(value: string): string;
        hasSameOrigin(value: string, other: string): boolean;
        isFileHTTP(value: string): boolean;
        isFileUNC(value: string): boolean;
        isDirectoryUNC(value: string): boolean;
        isUUID(value: string): boolean;
        resolveUri(value: string): string;
        resolvePath(value: string, href: string): string;
        joinPath(...values: Undef<string>[]): string;
        getFileSize(value: PathLike): number;
        loadSettings(value: Settings): void;
        allSettled<T>(values: readonly (T | PromiseLike<T>)[], rejected?: string | [string, string]): Promise<PromiseSettledResult<T>[]>;
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