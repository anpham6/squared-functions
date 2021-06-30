import type { IDocument, IFileManager } from './index';

import type { ExternalAsset } from './asset';
import type { ModuleWriteFailMethod } from './logger';

export interface SourceInput<T = [string, string?][]> {
    sourceFile?: T;
    sourcesRelativeTo?: string;
}

export interface SourceCode {
    code: string;
    map?: SourceMap;
}

export interface DocumentData {
    document?: StringOfArray;
}

export interface ChunkFile {
    code: string;
    filename?: string;
    entryPoint?: boolean;
}

export interface ChunkData extends ChunkFile {
    sourceMap?: SourceMapInput;
}

export interface TransformOutput extends SourceInput<string> {
    file?: ExternalAsset;
    mimeType?: string;
    chunks?: boolean;
    sourceMap?: SourceMapInput;
    external?: PlainObject;
    getSourceFiles?: () => SourceInput;
}

export interface TransformOptions<T = StandardMap, U = StandardMap> extends Omit<TransformOutput, "chunks"> {
    baseConfig: T;
    outputConfig: U;
    sourceMap: SourceMapInput;
    writeFail: ModuleWriteFailMethod;
    supplementChunks?: ChunkData[];
    outputSourceFiles?: string[];
    createSourceMap: (value: string) => SourceMapInput;
}

export interface TransformResult extends SourceCode {
    chunks?: Null<(SourceCode & ChunkFile)[]>;
    sourceFiles?: string[];
    sourceMappingURL?: string;
}

export interface SourceMapOptions {
    file?: string;
    sourceRoot?: string;
    sourceMappingURL?: string;
}

export interface SourceMapInput extends TransformResult {
    output: Map<string, SourceMapOutput>;
    reset: () => void;
    nextMap: (name: string, code: string, map: SourceMap | string, sourceMappingURL?: string, emptySources?: boolean) => boolean;
}

export interface SourceMapOutput extends TransformResult {}

export interface SourceMap {
    version: number;
    sources: string[];
    names: string[];
    mappings: string;
    file?: string;
    sourceRoot?: string;
    sourcesContent?: Null<string>[];
}

export type Transformer = FunctionType<Undef<Promise<string> | string>>;
export type ConfigOrTransformer = StandardMap | Transformer;
export type PluginConfig = [string, Undef<ConfigOrTransformer>, Undef<StandardMap>] | [];
export type TransformCallback = (this: IFileManager, instance: IDocument, documentDir: string) => Void<Promise<void>>;