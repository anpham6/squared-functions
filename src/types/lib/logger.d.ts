/* eslint no-shadow: "off" */

import type { BackgroundColor, ForegroundColor } from 'chalk';

export enum LOG_TYPE {
    UNKNOWN = 0,
    SYSTEM = 1,
    NODE = 2,
    PROCESS = 4,
    COMPRESS = 8,
    WATCH = 16,
    FILE = 32,
    CLOUD = 64,
    TIME_ELAPSED = 128,
    TIME_PROCESS = 256,
    FAIL = 512
}

export interface LogMessageOptions {
    useColor?: boolean;
    titleColor?: typeof ForegroundColor;
    titleBgColor?: typeof BackgroundColor;
    valueColor?: typeof ForegroundColor;
    valueBgColor?: typeof BackgroundColor;
    hintColor?: typeof ForegroundColor;
    hintBgColor?: typeof BackgroundColor;
    messageColor?: typeof ForegroundColor;
    messageBgColor?: typeof BackgroundColor;
}

export interface LoggerFormat {
    width?: number;
    justify?: "left" | "center" | "right";
}

export type LogValue = string | [string, Optional<string>];
export type ModuleWriteFailMethod = (value: string | [string, string], message?: Null<Error>, type?: LOG_TYPE) => void;
export type ModuleFormatMessageMethod = (type: LOG_TYPE, title: string, value: string | [string, string], message?: unknown, options?: LogMessageOptions) => void;