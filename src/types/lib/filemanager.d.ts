import type { FileInfo } from './squared';

import type { HttpRequest, HttpVersionAction } from './http';

import type { WriteStream } from 'fs';
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

export interface HttpClientOptions extends FetchBufferOptions, HttpRequest {
    method?: string;
    localStream?: WriteStream;
    outAbort?: AbortController;
}

export interface FetchBufferOptions extends HttpVersionAction {
    headers?: OutgoingHttpHeaders;
    timeout?: number;
}

export type HttpBaseHeaders = ObjectMap<OutgoingHttpHeaders>;
export type PerformAsyncTaskMethod = () => void;
export type PostFinalizeCallback = (files: FileInfo[], errors: string[]) => void;
export type CompleteAsyncTaskCallback<T = unknown, U = unknown> = (err?: Null<Error>, value?: T, parent?: U) => void;