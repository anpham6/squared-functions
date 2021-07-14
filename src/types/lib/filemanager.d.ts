import type { FileInfo } from './squared';

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

export interface HttpHostData {
    authority: string;
    credentials: string;
    version: number;
    protocol: string;
    secure: boolean;
    localhost: boolean;
    success: number[];
    failed: number[];
    headers?: OutgoingHttpHeaders;
    v2(): boolean;
}

export interface HttpHostRequest {
    host: HttpHostData;
    url: URL;
}

export interface FetchBufferOptions extends HttpVersionAction {}

export interface HttpClientOptions extends HttpVersionAction, Partial<HttpHostRequest> {
    method?: string;
    headers?: OutgoingHttpHeaders;
    localStream?: WriteStream;
    timeout?: number;
    outAbort?: AbortController;
}
export type HttpVersionSupport = 1 | 2;
export type PerformAsyncTaskMethod = () => void;
export type PostFinalizeCallback = (files: FileInfo[], errors: string[]) => void;
export type CompleteAsyncTaskCallback<T = unknown, U = unknown> = (err?: Null<Error>, value?: T, parent?: U) => void;