import type { RequestData } from './squared';

import type { ExternalAsset } from './asset';
import type { CloudModule, DocumentModule, ImageModule, LoggerModule, TaskModule } from './module';

type BoolString = boolean | string;

export interface RequestBody extends RequestData {
    assets: ExternalAsset[];
}

export interface Settings {
    apiVersion?: string;
    image?: ImageModule;
    document?: ObjectMap<DocumentModule>;
    task?: ObjectMap<TaskModule>;
    cloud?: CloudModule;
    logger?: LoggerModule;
}