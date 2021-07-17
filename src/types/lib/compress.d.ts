import type { CompressFormat } from './squared';

import type { CompleteAsyncTaskCallback } from './filemanager';

export type CompressTryFileMethod = (file: string | Buffer, output: string, data: CompressFormat, callback?: CompleteAsyncTaskCallback<string>) => void;