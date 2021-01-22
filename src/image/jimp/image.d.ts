import type { IFileManager, ImageConstructor } from '../../types/lib';
import type { FinalizeImageCallback } from '../../types/lib/filemanager';

import type { ImageHandler } from '../types';

import type * as jimp from 'jimp';

export interface IJimpImageHandler extends ImageHandler<IFileManager, jimp> {
    setCommand(value: string, finalAs?: string): void;
    getBuffer(tempFile?: boolean, saveAs?: string, finalAs?: string): Promise<Null<Buffer | string>>;
    rotate(pathFile?: string, callback?: FinalizeImageCallback<string>): Void<Promise<unknown>[]>;
    finalize(output: string, callback: (err: Null<Error>, result: string) => void, finalAs?: string): void;
}

export interface JimpImageConstructor extends ImageConstructor {
    parseFormat(command: string, mimeType?: string): [string, string, string];
}