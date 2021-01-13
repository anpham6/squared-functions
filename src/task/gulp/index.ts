import type { ExtendedSettings, ExternalAsset, IFileManager } from '../../types/lib';

import path = require('path');
import fs = require('fs-extra');
import child_process = require('child_process');

import Task from '../index';

type TaskModule = ExtendedSettings.TaskModule;

interface GulpData {
    gulpfile: string;
    items: string[];
}

interface GulpTask extends PlainObject {
    task: string;
    origDir: string;
    data: GulpData;
}

class Gulp extends Task {
    public static async using(this: IFileManager, instance: Gulp, assets: ExternalAsset[], beforeStage = false) {
        const gulp = instance.module.settings as Undef<StringMap>;
        if (!gulp) {
            return;
        }
        const taskMap = new Map<string, Map<string, GulpData>>();
        const origMap = new Map<string, string[]>();
        const tasks: Promise<unknown>[] = [];
        for (const item of assets) {
            const origDir = path.dirname(item.localUri!);
            const scheduled = new Set<string>();
            let gulpfile: Undef<string>;
            for (const { handler, task, preceding } of item.tasks!) {
                if (instance.taskName === handler && !!preceding === beforeStage && !scheduled.has(task) && (gulpfile = gulp[task]) && fs.existsSync(gulpfile = path.resolve(gulpfile))) {
                    if (!taskMap.has(task)) {
                        taskMap.set(task, new Map<string, GulpData>());
                    }
                    const dirMap = taskMap.get(task)!;
                    if (!dirMap.has(origDir)) {
                        dirMap.set(origDir, { gulpfile, items: [] });
                    }
                    dirMap.get(origDir)!.items.push(item.localUri!);
                    scheduled.add(task);
                    delete item.sourceUTF8;
                }
            }
            if (scheduled.size) {
                const stored = origMap.get(origDir);
                const items = Array.from(scheduled);
                if (!stored) {
                    origMap.set(origDir, items);
                }
                else {
                    let previous = -1;
                    for (const task of items.reverse()) {
                        const index = stored.indexOf(task);
                        if (index !== -1) {
                            if (index > previous) {
                                stored.splice(index, 1);
                            }
                            else {
                                previous = index;
                                continue;
                            }
                        }
                        if (previous !== -1) {
                            stored.splice(previous--, 0, task);
                        }
                        else {
                            stored.push(task);
                            previous = stored.length - 1;
                        }
                    }
                }
            }
        }
        const itemsAsync: GulpTask[] = [];
        const itemsSync: GulpTask[] = [];
        for (const [task, dirMap] of taskMap) {
            for (const [origDir, data] of dirMap) {
                const item = origMap.get(origDir);
                (item && item.length > 1 ? itemsSync : itemsAsync).push({ task, origDir, data });
            }
        }
        itemsSync.sort((a, b) => {
            if (a.origDir === b.origDir && a.task !== b.task) {
                const taskData = origMap.get(a.origDir)!;
                const indexA = taskData.indexOf(a.task);
                const indexB = taskData.indexOf(b.task);
                if (indexA !== -1 && indexB !== -1) {
                    if (indexA < indexB) {
                        return -1;
                    }
                    if (indexB < indexA) {
                        return 1;
                    }
                }
            }
            return 0;
        });
        for (const item of itemsAsync) {
            tasks.push(new Promise(resolve => instance.execute(this, item, resolve)));
        }
        if (itemsSync.length) {
            tasks.push(new Promise<void>(resolve => {
                (function nextTask(this: IFileManager) { // eslint-disable-line no-shadow
                    const item = itemsSync.shift();
                    if (item) {
                        instance.execute(this, item, nextTask.bind(this));
                    }
                    else {
                        resolve();
                    }
                }).bind(this)();
            }));
        }
        if (tasks.length) {
            await Task.allSettled(tasks, ['Execute tasks <finalize>', instance.taskName], this.errors);
        }
    }

    public readonly taskName = 'gulp';

    constructor(module: TaskModule) {
        super(module);
    }

    execute(manager: IFileManager, gulp: GulpTask, callback: (value?: unknown) => void) {
        const { task, origDir, data } = gulp;
        const errorHint = this.taskName + ': ' + task;
        try {
            const tempDir = this.getTempDir(true);
            fs.mkdirpSync(tempDir);
            Promise.all(data.items.map(uri => fs.copyFile(uri, path.join(tempDir, path.basename(uri)))))
                .then(() => {
                    this.formatMessage(this.logType.PROCESS, 'gulp', ['Executing task...', task], data.gulpfile);
                    const time = Date.now();
                    child_process.exec(`gulp ${task} --gulpfile "${data.gulpfile.replace(/\\/g, '\\\\')}" --cwd "${tempDir.replace(/\\/g, '\\\\')}"`, { cwd: process.cwd() }, err => {
                        if (!err) {
                            Promise.all(data.items.map(uri => fs.unlink(uri).then(() => manager.delete(uri))))
                                .then(() => {
                                    fs.readdir(tempDir)
                                        .then(value => {
                                            Promise.all(
                                                value.map(filename => {
                                                    const uri = path.join(origDir, filename);
                                                    return fs.move(path.join(tempDir, filename), uri, { overwrite: true }).then(() => manager.add(uri));
                                                })
                                            )
                                            .then(() => {
                                                this.writeTimeElapsed('gulp', task, time);
                                                callback();
                                            })
                                            .catch(error => {
                                                this.writeFail(['Unable to replace files <exec>', errorHint], error);
                                                callback();
                                            });
                                        }
                                    )
                                    .catch(error => {
                                        this.writeFail(['Unable to read directory <exec>', errorHint], error);
                                        callback();
                                    });
                                })
                                .catch(error => {
                                    this.writeFail(['Unable to delete files <exec>', errorHint], error);
                                    callback();
                                });
                        }
                        else {
                            this.writeFail(['Unknown <exec>', errorHint], err);
                            callback();
                        }
                    });
                })
                .catch(err => {
                    this.writeFail(['Unable to copy original files', errorHint], err);
                    callback();
                });
        }
        catch (err) {
            this.writeFail(['Unknown', errorHint], err);
            callback();
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Gulp;
    module.exports.default = Gulp;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Gulp;