import type { ControllerSettingsDirectoryUI as IControllerSettingsDirectoryUI } from './squared';

export interface ManifestData extends PlainObject {
    package?: string;
    application?: {
        supportRTL?: boolean;
        theme?: string;
        activityName?: string;
    };
}

export interface ControllerSettingsDirectoryUI extends IControllerSettingsDirectoryUI {
    main: string;
    animation: string;
    theme: string;
}