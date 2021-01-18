import type { ExternalAsset, FileData } from './asset';
import type { OutputData } from './image';

export interface InstallData<T, U> {
    instance: T;
    constructor: U;
    params: unknown[];
}

export type PerformAsyncTaskMethod = () => void;
export type QueueImageMethod = (data: FileData, ouputType: string, saveAs: string, command?: string) => Undef<string>;
export type CompleteAsyncTaskCallback = (err?: Null<Error>, value?: unknown, parent?: ExternalAsset) => void;
export type FinalizeImageCallback<T = void> = (err: Null<Error>, data: OutputData) => T;