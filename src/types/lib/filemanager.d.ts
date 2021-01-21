import type { ExternalAsset, FileData } from './asset';

export interface InstallData<T, U> {
    instance: T;
    constructor: U;
    params: unknown[];
}

export type PerformAsyncTaskMethod = () => void;
export type QueueImageMethod = (data: FileData, saveAs: string, command?: string) => Undef<string>;
export type CompleteAsyncTaskCallback = (err?: Null<Error>, value?: unknown, parent?: ExternalAsset) => void;
export type FinalizeImageCallback<T = unknown, U = void> = (err: Null<Error>, result: T) => U;