import type { ExternalAsset } from './asset';

interface FileWatch {
    uri: string;
    assets: ExternalAsset[];
    start: number;
    expires: number;
    interval: number;
    id?: string;
    port?: number;
    socketId?: string;
    secure?: boolean;
    hot?: boolean;
    etag?: string;
}