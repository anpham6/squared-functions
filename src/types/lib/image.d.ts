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

export interface TransformOptions {
    mimeType?: string;
    tempFile?: boolean;
    time?: number;
}