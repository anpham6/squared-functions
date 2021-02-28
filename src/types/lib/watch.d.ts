import type { ExternalAsset } from './asset';

interface FileWatch {
    uri: string;
    assets: ExternalAsset[];
    start: number;
    expires: number;
    interval: number;
    port?: number;
    socketId?: string;
    secure?: boolean;
    etag?: string;
}