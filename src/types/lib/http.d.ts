import type { OutgoingHttpHeaders } from 'http';

export interface HttpVersionAction {
    httpVersion?: HttpVersionSupport;
}

export interface IHttpHost {
    version: HttpVersionSupport;
    origin: string;
    credentials: string;
    protocol: string;
    hostname: string;
    port: string;
    secure: boolean;
    localhost: boolean;
    headers: Null<OutgoingHttpHeaders>;
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

export interface HttpRequest extends HttpVersionAction {
    host: IHttpHost;
    url: URL;
}

export type HttpVersionSupport = 1 | 2;