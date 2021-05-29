/// <reference path="type.d.ts" />

export interface ManifestData extends PlainObject {
    package?: string;
    application?: {
        supportRTL?: boolean;
        theme?: string;
        activityName?: string;
    };
}