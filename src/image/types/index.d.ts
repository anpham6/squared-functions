import type { IScopeOrigin } from '../../types/lib';
import type { FileData } from '../../types/lib/asset';

export interface ImageHandler<T, U> extends IScopeOrigin<T, U> {
    data?: FileData;
    readonly rotateCount: number;
    method(): void;
    resize(): void;
    crop(): void;
    opacity(): void;
    quality(): void;
    rotate(): void;
    write(output: string, callback?: StandardCallback): void;
    getBuffer(tempFile?: boolean, saveAs?: string): Promise<Null<Buffer | string>>;
    finalize(output: string, callback: (err: Null<Error>, result: string) => void): void;
}