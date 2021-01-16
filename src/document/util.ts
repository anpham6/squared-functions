import type { ModuleWriteFailMethod } from '../types/lib';

export function loadPlugins<T = unknown>(name: string, plugins: [string, Undef<PlainObject>][], writeFail?: ModuleWriteFailMethod) {
    const result: T[] = [];
    for (const plugin of plugins.map(item => typeof item === 'string' ? [item] : Array.isArray(item) && item.length ? item : null)) {
        if (plugin) {
            try {
                result.push(require(plugin[0])(plugin[1]));
            }
            catch (err) {
                if (writeFail) {
                    writeFail([`Install required? <npm i ${plugin[0]}>`, name], err);
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