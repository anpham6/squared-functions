import type { CacheTimeout } from './cloud';
import type { LoggerFormat } from './logger';

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
    format?: {
        title?: LoggerFormat;
        value?: LoggerFormat;
        hint?: LoggerFormat;
        message?: LoggerFormat;
    };
    silent?: boolean;
    message?: boolean;
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
    time_process?: boolean;
}