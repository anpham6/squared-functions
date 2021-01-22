import type { IScopeOrigin } from '../../types/lib';
import type { FileData } from '../../types/lib/asset';
import type { FinalizeImageCallback } from '../../types/lib/image';

export class ImageHandler<T, U> implements IScopeOrigin<T, U> {
    instance: U;
    data?: FileData;
    method(): void;
    resize(): void;
    crop(): void;
    opacity(): void;
    quality(): void;
    rotate(): void;
    write(output: string, callback?: FinalizeImageCallback): void;
    getBuffer(tempFile?: boolean, saveAs?: string): Promise<Null<Buffer | string>>;
    finalize(output: string, callback: (err: Null<Error>, result: string) => void): void;
    get rotateCount(): number;
    constructor(instance: U, data: FileData);
}