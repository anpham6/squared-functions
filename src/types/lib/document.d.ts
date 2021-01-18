import type { ExternalAsset } from './asset';
import type { ModuleWriteFailMethod } from './logger';

export interface DocumentData {
    document?: string | string[];
}

export interface TransformOutput<T = StandardMap, U = StandardMap> {
    file?: ExternalAsset;
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