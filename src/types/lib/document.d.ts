import type { IDocument, IFileManager } from './index';

import type { ExternalAsset } from './asset';
import type { ModuleWriteFailMethod } from './logger';

export interface DocumentData {
    document?: StringOfArray;
}

export interface TransformOutput {
    file?: ExternalAsset;
    sourceFile?: string;
    sourcesRelativeTo?: string;
    sourceMap?: SourceMapInput;
    external?: PlainObject;
}

export interface TransformOptions<T = StandardMap, U = StandardMap> extends TransformOutput {
    baseConfig: T;
    outputConfig: U;
    sourceMap: SourceMapInput;
    writeFail: ModuleWriteFailMethod;
}

export interface TransformResult {
    code: string;
    map?: SourceMap;
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
    nextMap: (name: string, code: string, map: SourceMap | string, sourceMappingURL?: string) => boolean;
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