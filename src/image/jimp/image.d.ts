import type { IFileManager, ImageConstructor, ImageHandler } from '../../types/lib';
import type * as jimp from 'jimp';

export interface IJimpImageHandler extends ImageHandler<IFileManager, jimp> {
    setCommand(value: string, finalAs?: string): void;
    getBuffer(saveAs?: string, finalAs?: string): Promise<Null<Buffer>>;
    finalize(output: string, callback: (err: Null<Error>, result: string) => void, finalAs?: string): void;
}

export interface JimpImageConstructor extends ImageConstructor {
    parseFormat(value: string, mimeType?: string): [string, string, string];
}