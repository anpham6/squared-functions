import type { FileInfo } from './squared';

import type { ExternalAsset } from './asset';

export interface InstallData<T, U> {
    instance: T;
    constructor: U;
    params: unknown[];
}

export type PerformAsyncTaskMethod = () => void;
export type PostFinalizeCallback = (files: FileInfo[], errors: string[]) => void;
export type CompleteAsyncTaskCallback = (err?: Null<Error>, value?: unknown, parent?: ExternalAsset) => void;