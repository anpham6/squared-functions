import type { FileData } from './asset';

export interface OutputData extends FileData {
    output: string;
    command: string;
    baseDirectory?: string;
    errors?: string[];
}

export interface RotateData {
    values: number[];
    color: number;
}

export interface ResizeData extends Dimension {
    mode: string;
    color: number;
    align: Undef<string>[];
    algorithm?: string;
}

export interface CropData extends Point, Dimension {}

export interface QualityData {
    value: number;
    nearLossless: number;
    preset?: string;
}

export type FinalizeImageCallback<T = unknown, U = void> = (err: Null<Error>, result: T) => U;