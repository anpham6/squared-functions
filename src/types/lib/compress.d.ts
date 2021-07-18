import type { CompressFormat } from './squared';

import type { CompleteAsyncTaskCallback } from './filemanager';

export type CompressTryFileMethod = (file: BufferOfURI, output: string, data: CompressFormat, callback?: CompleteAsyncTaskCallback<string>) => void;