import type { WriteStream } from 'fs';
import type { ClientRequest, IncomingHttpHeaders, OutgoingHttpHeaders } from 'http';
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
    hasProtocol(version: HttpVersionSupport): Promise<boolean>;
    upgrade(value: Undef<string>, upgrade?: boolean): void;
    success(version?: HttpVersionSupport): number;
    failed(version?: HttpVersionSupport): number;
    error(): number;
    clone(version?: HttpVersionSupport): IHttpHost;
    setData(value: number[][]): void;
    v2(): boolean;
}

export interface HttpProxyData {
    host: URL;
    exclude?: string[];
    include?: string[];
}

export interface HttpRequest extends HttpRequestOptions {
    host: IHttpHost;
    url: URL;
}

export interface HttpRequestOptions {
    host?: IHttpHost;
    url?: URL;
    httpVersion?: HttpVersionSupport;
    method?: "GET" | "HEAD";
    encoding?: BufferEncoding;
    headers?: OutgoingHttpHeaders;
    timeout?: number;
    keepAliveTimeout?: number;
    pipeTo?: string;
    connected?: (headers: IncomingHttpHeaders) => Void<boolean>;
    statusMessage?: string;
    outStream?: WriteStream;
    outAbort?: AbortController;
}

export type HttpRequestClient = ClientRequest | ClientHttp2Stream;
export type HttpVersionSupport = 1 | 2;