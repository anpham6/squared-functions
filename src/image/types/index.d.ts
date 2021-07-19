import type { IScopeOrigin } from '../../types/lib';
import type { FileProcessing } from '../../types/lib/asset';

export interface ImageHandler<T, U> extends IScopeOrigin<T, U> {
    data?: FileProcessing;
    readonly rotateCount: number;
    method(): void;
    resize(): void;
    crop(): void;
    opacity(): void;
    quality(): void;
    rotate(): void;
    write(output: string, callback?: StandardCallback): void;
    getBuffer(tempFile?: boolean, saveAs?: string): Promise<Null<BufferContent>>;
    finalize(output: string, callback: (err: Null<Error>, result: string) => void): void;
}