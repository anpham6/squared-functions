import type { IFileManager } from '../../types/lib';
import type { ExternalAsset } from '../../types/lib/asset';

import path = require('path');
import fs = require('fs-extra');
import child_process = require('child_process');
import which = require('which');

import Task from '../index';

interface GulpData {
    gulpfile: string;
    items: string[];
}

interface GulpTask extends PlainObject {
    task: string;
    origDir: string;
    data: GulpData;
}

const PATH_GULPBIN = which.sync('gulp', { nothrow: true });

const sanitizePath = (value: string) => value.replace(/\\/g, '\\\\');

class Gulp extends Task {
    static async using(this: IFileManager, instance: Gulp, assets: ExternalAsset[], beforeStage = false) {
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
            for (const { handler, task, preceding } of item.tasks!) {
                if (instance.moduleName === handler && !!preceding === beforeStage) {
                    let gulpfile = gulp[task];
                    if (gulpfile) {
                        if (!scheduled.has(task)) {
                            try {
                                if (fs.existsSync(gulpfile = path.resolve(gulpfile))) {
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
                            catch (err) {
                                instance.writeFail(['Unable to resolve file', gulpfile], err);
                            }
                        }
                    }
                    else {
                        instance.writeFail(['Unable to locate task', instance.moduleName + ': ' + task], new Error(task + ' (Unknown)'));
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
            await Task.allSettled(tasks, ['Execute tasks', instance.moduleName], this.errors);
        }
    }

    moduleName = 'gulp';

    execute(manager: IFileManager, gulp: GulpTask, callback: (value?: unknown) => void) {
        const { task, origDir, data } = gulp;
        const tempDir = this.getTempDir(true);
        try {
            fs.mkdirpSync(tempDir);
            const hint = this.moduleName + ': ' + task;
            Promise.all(data.items.map(uri => fs.copyFile(uri, path.join(tempDir, path.basename(uri)))))
                .then(() => {
                    this.formatMessage(this.logType.PROCESS, 'gulp', ['Executing task...', task], data.gulpfile);
                    const time = Date.now();
                    const output = PATH_GULPBIN ? child_process.execFile(PATH_GULPBIN, [task, '--gulpfile', `"${sanitizePath(data.gulpfile)}"`, '--cwd', `"${sanitizePath(tempDir)}"`], { cwd: process.cwd(), shell: true }) : child_process.exec(`gulp ${task} --gulpfile "${sanitizePath(data.gulpfile)}" --cwd "${sanitizePath(tempDir)}"`, { cwd: process.cwd() });
                    output.on('close', code => {
                        if (!code) {
                            Task.allSettled(data.items.map(uri => fs.unlink(uri).then(() => manager.delete(uri))), ['Unable to delete file', hint], this.errors)
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
                                                this.writeTimeProcess('gulp', task, time);
                                                callback();
                                            })
                                            .catch(err_1 => {
                                                this.writeFail(['Unable to replace files', hint], err_1, this.logType.FILE);
                                                callback();
                                            });
                                        }
                                    )
                                    .catch(err_1 => {
                                        this.writeFail(['Unable to read directory', hint], err_1);
                                        callback();
                                    });
                                });
                        }
                        else {
                            callback();
                        }
                    });
                    output.on('error', err => this.writeFail(['Unknown', hint], err));
                });
        }
        catch (err) {
            this.writeFail(['Unable to create directory', tempDir], err, this.logType.FILE);
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