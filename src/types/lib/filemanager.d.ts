import type { FileInfo } from './squared';

export interface InstallData<T, U> {
    instance: T;
    constructor: U;
    params: unknown[];
}

export interface HttpRequestBuffer {
    expires: number;
    limit?: string;
}

export type PerformAsyncTaskMethod = () => void;
export type PostFinalizeCallback = (files: FileInfo[], errors: string[]) => void;
export type CompleteAsyncTaskCallback<T = unknown, U = unknown> = (err?: Null<Error>, value?: T, parent?: U) => void;