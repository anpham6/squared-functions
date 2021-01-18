import type { CompressFormat } from './squared';

import type { CompleteAsyncTaskCallback, PerformAsyncTaskMethod } from './filemanager';

export type CompressTryImageCallback = (value: unknown) => void;
export type CompressTryFileMethod = (uri: string, data: CompressFormat, performAsyncTask?: Null<PerformAsyncTaskMethod>, callback?: CompleteAsyncTaskCallback) => void;