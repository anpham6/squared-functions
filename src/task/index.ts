import type { ExtendedSettings, ExternalAsset, IFileManager, ITask } from '../types/lib';

import Module from '../module';

type TaskModule = ExtendedSettings.TaskModule;

abstract class Task extends Module implements ITask {
    public static async using(this: IFileManager, instance: ITask, assets: ExternalAsset[]): Promise<void> {}

    public abstract readonly moduleName: string;

    constructor(public module: TaskModule) {
        super();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Task;
    module.exports.default = Task;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Task;