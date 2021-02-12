import type { IFileManager, ITask } from '../types/lib';
import type { ExternalAsset } from '../types/lib/asset';
import type { TaskModule } from '../types/lib/module';

import Module from '../module';

abstract class Task extends Module implements ITask {
    static async using(this: IFileManager, instance: ITask, assets: ExternalAsset[]) {}

    abstract readonly moduleName: string;

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