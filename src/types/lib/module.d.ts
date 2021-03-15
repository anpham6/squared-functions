import type { CacheTimeout } from './cloud';

export interface HandlerModule {
    handler?: string;
}

export interface DocumentModule extends HandlerModule {
    eval_function?: boolean;
    eval_template?: boolean;
    settings?: PlainObject;
}

export interface TaskModule extends HandlerModule {
    settings?: PlainObject;
}

export interface ImageModule extends HandlerModule, StringMap {}

export interface CloudModule {
    cache?: Partial<CacheTimeout>;
    aws?: ObjectMap<StringMap>;
    azure?: ObjectMap<StringMap>;
    gcloud?: ObjectMap<StringMap>;
    ibm?: ObjectMap<StringMap>;
    oci?: ObjectMap<StringMap>;
}

export interface LoggerModule {
    color?: boolean;
    unknown?: boolean;
    system?: boolean;
    node?: boolean;
    process?: boolean;
    compress?: boolean;
    watch?: boolean;
    file?: boolean;
    cloud?: boolean;
    time_elapsed?: boolean;
}