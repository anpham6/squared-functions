import type { TextEncoding } from './squared';

import type { WriteStream } from 'fs';
import type { ClientRequest, OutgoingHttpHeaders } from 'http';
import type { ClientHttp2Stream } from 'http2';

export interface IHttpHost {
    version: HttpVersionSupport;
    origin: string;
    credentials: string;
    protocol: string;
    hostname: string;
    port: string;
    secure: boolean;
    localhost: boolean;
    headers: Undef<OutgoingHttpHeaders>;
    hasProtocol(version?: number): Promise<boolean>;
    success(version?: HttpVersionSupport): number;
    failed(version?: HttpVersionSupport): number;
    error(): number;
    clone(version?: HttpVersionSupport): IHttpHost;
    v2(): boolean;
}

export interface HttpProxyData {
    host: URL;
    exclude?: string[];
    include?: string[];
}

export interface HttpRequest {
    host: IHttpHost;
    url: URL;
    retries: number;
    httpVersion: HttpVersionSupport;
    method?: string;
    encoding?: TextEncoding;
    headers?: OutgoingHttpHeaders;
    timeout?: number;
    pipeTo?: WriteStream;
    outResult?: Null<BufferContent>;
    outError?: unknown;
    outAbort?: AbortController;
}

export type HttpAlpnProtocol = "h2" | "h2c";
export type HttpRequestClient = ClientRequest | ClientHttp2Stream;
export type HttpVersionSupport = 1 | 2;