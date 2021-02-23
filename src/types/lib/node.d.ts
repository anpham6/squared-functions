import type { RequestData } from './squared';
import type * as chrome from './chrome';

import type { ExternalAsset } from './asset';
import type { CloudModule, CompressModule, DocumentModule, ImageModule, LoggerModule, TaskModule, WatchModule } from './module';

type BoolString = boolean | string;

export interface RequestBody extends RequestData, chrome.RequestData {
    assets: ExternalAsset[];
}

export interface PermissionSettings {
    disk_read?: BoolString;
    disk_write?: BoolString;
    unc_read?: BoolString;
    unc_write?: BoolString;
}

export interface Settings extends PermissionSettings {
    apiVersion?: string;
    compress?: CompressModule;
    image?: ImageModule;
    document?: ObjectMap<DocumentModule>;
    task?: ObjectMap<TaskModule>;
    watch?: WatchModule;
    cloud?: CloudModule;
    logger?: LoggerModule;
}