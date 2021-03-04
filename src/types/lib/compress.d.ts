import type { CompressFormat } from './squared';

import type { CompleteAsyncTaskCallback } from './filemanager';

export type CompressTryImageCallback = (value: unknown) => void;
export type CompressTryFileMethod = (uri: string, output: string, data: CompressFormat, callback?: CompleteAsyncTaskCallback) => void;