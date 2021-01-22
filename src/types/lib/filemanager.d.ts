import type { ExternalAsset } from './asset';

export interface InstallData<T, U> {
    instance: T;
    constructor: U;
    params: unknown[];
}

export type PerformAsyncTaskMethod = () => void;
export type CompleteAsyncTaskCallback = (err?: Null<Error>, value?: unknown, parent?: ExternalAsset) => void;