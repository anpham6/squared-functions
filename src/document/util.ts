import type { ModuleWriteFailMethod } from '../types/lib/logger';

export function loadPlugins<T = unknown>(name: string, plugins: unknown[], writeFail?: ModuleWriteFailMethod) {
    const result: T[] = [];
    for (const plugin of plugins.map(item => typeof item === 'string' ? [item] : Array.isArray(item) && typeof item[0] === 'string' ? item : null) as Null<[string, Undef<PlainObject>]>[]) {
        if (plugin) {
            try {
                result.push(require(plugin[0])(plugin[1]));
            }
            catch (err) {
                if (writeFail) {
                    writeFail([`Install required? <${name}>`, 'npm i ' + plugin[0]], err);
                }
            }
        }
    }
    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { loadPlugins };
    Object.defineProperty(module.exports, '__esModule', { value: true });
}