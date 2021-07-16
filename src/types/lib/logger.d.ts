/* eslint no-shadow: "off" */

import type { BackgroundColor, ForegroundColor } from 'chalk';

export const enum ERR_MESSAGE {
    UNKNOWN = 'Unknown',
    INSTALL = 'Install required?',
    READ_FILE = 'Unable to read file',
    WRITE_FILE = 'Unable to write file',
    COPY_FILE = 'Unable to copy file',
    DELETE_FILE = 'Unable to delete file',
    RENAME_FILE = 'Unable to rename file',
    MOVE_FILE = 'Unable to move file',
    CONVERT_FILE = 'Unable to convert file',
    DOWNLOAD_FILE = 'Unable to download file',
    RESOLVE_FILE = 'Unable to resolve file',
    REPLACE_FILE = 'Unable to replace file',
    COMPRESS_FILE = 'Unable to compress file',
    WATCH_FILE = 'Unable to watch file',
    CREATE_DIRECTORY = 'Unable to create directory',
    READ_DIRECTORY = 'Unable to read directory',
    DELETE_DIRECTORY = 'Unable to delete directory',
    LOAD_CONFIG = 'Unable to load configuration',
    READ_BUFFER = 'Unable to read buffer'
}

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
    FAIL = 512,
    HTTP = 1024
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
    type?: LOG_TYPE;
    failed?: boolean;
}

export interface LogTimeProcessOptions extends LogMessageOptions {
    meterIncrement?: number;
}

export interface LoggerFormat {
    width?: number;
    color?: typeof ForegroundColor;
    bgColor?: typeof BackgroundColor;
    justify?: "left" | "center" | "right";
}

export type LogValue = string | [string, Optional<string>];
export type ModuleWriteFailMethod = (value: LogValue, message?: Null<Error>, type?: LOG_TYPE) => void;
export type ModuleFormatMessageMethod = (type: LOG_TYPE, title: string, value: LogValue, message?: unknown, options?: LogMessageOptions) => void;