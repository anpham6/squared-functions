import type { ExternalAsset } from './asset';
import type { ModuleWriteFailMethod } from './logger';

export interface DocumentData {
    document?: string | string[];
}

export interface TransformOutput<T = StandardMap, U = StandardMap> {
    baseConfig?: T;
    outputConfig?: U;
    sourceFile?: string;
    sourceMap?: SourceMapInput;
    sourcesRelativeTo?: string;
    external?: PlainObject;
    writeFail?: ModuleWriteFailMethod;
}

export interface TransformResult {
    code: string;
    map?: SourceMap;
}

export interface SourceMapInput extends TransformResult {
    output: Map<string, SourceMapOutput>;
    file?: ExternalAsset;
    streamingContent?: boolean;
    nextMap: (name: string, code: string, map: SourceMap | string) => boolean;
}

export interface SourceMapOutput extends Required<TransformResult> {}

export interface SourceMap {
    version: number;
    sources: string[];
    names: string[];
    mappings: string;
    file?: string;
    sourceRoot?: string;
    sourcesContent?: Null<string>[];
}

export type Transformer = FunctionType<Undef<string>>;
export type ConfigOrTransformer = StandardMap | Transformer;
export type PluginConfig = [string, Undef<ConfigOrTransformer>, Undef<StandardMap>] | [];