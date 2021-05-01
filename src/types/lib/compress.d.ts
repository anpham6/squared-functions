import type { CompressFormat } from './squared';

import type { CompleteAsyncTaskCallback } from './filemanager';

export type CompressTryFileMethod = (uri: string, output: string, data: CompressFormat, callback?: CompleteAsyncTaskCallback<string>) => void;