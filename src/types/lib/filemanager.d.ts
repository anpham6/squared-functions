export interface InstallData<T, U> {
    instance: T;
    constructor: U;
    params: unknown[];
}

export type PerformAsyncTaskMethod = () => void;
export type CompleteAsyncTaskCallback<T = unknown, U = unknown> = (err?: Null<Error>, value?: T, parent?: U) => void;