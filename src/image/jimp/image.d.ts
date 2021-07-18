import type { IFileManager, ImageConstructor } from '../../types/lib';

import type { ImageHandler } from '../types';

export interface IJimpImageHandler<T> extends ImageHandler<IFileManager, T> {
    setCommand(value: string, finalAs?: string): void;
    getBuffer(tempFile?: boolean, saveAs?: string, finalAs?: string): Promise<Null<string | Buffer>>;
    rotate(pathFile?: string, callback?: StandardCallback<string>): Void<Promise<unknown>[]>;
    finalize(output: string, callback: (err: Null<Error>, result: string) => void, finalAs?: string): void;
}

export interface JimpImageConstructor<T> extends ImageConstructor {
    parseFormat(command: string, mimeType?: string): [string, string, string];
    new(instance: T): IJimpImageHandler<T>;
}