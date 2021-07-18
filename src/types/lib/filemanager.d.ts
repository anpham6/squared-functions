import type { FileInfo } from './squared';

import type { OutgoingHttpHeaders } from 'http';

export interface InstallData<T, U> {
    instance: T;
    constructor: U;
    params: unknown[];
}

export interface HttpRequestBuffer {
    expires: number;
    limit: number;
}

export interface HttpRequestSettings {
    headers?: HttpBaseHeaders;
    connectTimeout?: NumString;
    retryLimit?: NumString;
    retryDelay?: NumString;
}

export interface AssetContentOptions {
    uri: string;
    index: number;
    replacePattern?: string;
}

export type HttpBaseHeaders = ObjectMap<OutgoingHttpHeaders>;
export type PerformAsyncTaskMethod = () => void;
export type PostFinalizeCallback = (files: FileInfo[], errors: string[]) => void;
export type CompleteAsyncTaskCallback<T = unknown, U = unknown> = (err?: Null<Error>, value?: T, parent?: U) => void;