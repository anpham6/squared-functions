import type { CompressFormat } from './squared';

import type { CompleteAsyncTaskCallback, PerformAsyncTaskMethod } from './filemanager';

export type CompressTryImageCallback = (value: unknown) => void;
export type CompressTryFileMethod = (uri: string, output: string, data: CompressFormat, beforeAsync?: Null<PerformAsyncTaskMethod>, callback?: CompleteAsyncTaskCallback) => void;