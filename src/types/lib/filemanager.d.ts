import type { FileInfo } from './squared';

import type { HttpRequest, HttpVersionSupport } from './http';

import type { WriteStream } from 'fs';
import type { OutgoingHttpHeaders } from 'http';

interface HttpVersionAction {
    httpVersion?: HttpVersionSupport;
}

export interface InstallData<T, U> {
    instance: T;
    constructor: U;
    params: unknown[];
}

export interface HttpRequestBuffer {
    expires: number;
    limit: number;
}

export interface HttpClientOptions extends HttpVersionAction, Partial<HttpRequest> {
    method?: string;
    headers?: OutgoingHttpHeaders;
    localStream?: WriteStream;
    timeout?: number;
    outAbort?: AbortController;
}

export interface FetchBufferOptions extends HttpVersionAction {}

export type PerformAsyncTaskMethod = () => void;
export type PostFinalizeCallback = (files: FileInfo[], errors: string[]) => void;
export type CompleteAsyncTaskCallback<T = unknown, U = unknown> = (err?: Null<Error>, value?: T, parent?: U) => void;