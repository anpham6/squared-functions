import type { ExtendedSettings, ExternalAsset, IFileManager, ITask } from '../../types/lib';

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
    public static async finalize(this: IFileManager, instance: ITask, assets: ExternalAsset[]) {
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
            for (let { task } of item.tasks!) {
                if (!scheduled.has(task = task.trim()) && gulp[task]) {
                    const gulpfile = path.resolve(gulp[task]!);
                    if (fs.existsSync(gulpfile)) {
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
            await Promise.all(tasks).catch(err => this.writeFail(['Exec tasks', 'finalize'], err));
        }
    }

    public readonly taskName = 'gulp';

    constructor(module: TaskModule) {
        super(module);
    }

    execute(manager: IFileManager, gulp: GulpTask, callback: (value?: unknown) => void) {
        const { task, origDir, data } = gulp;
        const tempDir = this.getTempDir(true);
        try {
            fs.mkdirpSync(tempDir);
            Promise.all(data.items.map(uri => fs.copyFile(uri, path.join(tempDir, path.basename(uri)))))
                .then(() => {
                    this.formatMessage(this.logType.PROCESS, 'gulp', ['Executing task...', task], data.gulpfile);
                    const time = Date.now();
                    child_process.exec(`gulp ${task} --gulpfile "${data.gulpfile.replace(/\\/g, '\\\\')}" --cwd "${tempDir.replace(/\\/g, '\\\\')}"`, { cwd: process.cwd() }, err => {
                        if (!err) {
                            Promise.all(data.items.map(uri => fs.unlink(uri).then(() => manager.delete(uri))))
                                .then(() => {
                                    fs.readdir(tempDir, (err_r, files) => {
                                        if (!err_r) {
                                            Promise.all(
                                                files.map(filename => {
                                                    const uri = path.join(origDir, filename);
                                                    return fs.move(path.join(tempDir, filename), uri, { overwrite: true }).then(() => manager.add(uri));
                                                }))
                                                .then(() => {
                                                    this.writeTimeElapsed('gulp', task, time);
                                                    callback();
                                                })
                                                .catch(err_w => {
                                                    this.writeFail(['Unable to replace original files', 'gulp: ' + task], err_w);
                                                    callback();
                                                });
                                        }
                                        else {
                                            callback();
                                        }
                                    });
                                })
                                .catch(error => this.writeFail(['Unable to delete original files', 'gulp: ' + task], error));
                        }
                        else {
                            this.writeFail(['Unknown', 'gulp: ' + task], err);
                            callback();
                        }
                    });
                })
                .catch(err => this.writeFail(['Unable to copy original files', 'gulp: ' + task], err));
        }
        catch (err) {
            this.writeFail(['Unknown', 'gulp: ' + task], err);
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