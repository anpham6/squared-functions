import type { ModuleWriteFailMethod } from '../types/lib';

export function loadPlugins<T = unknown>(name: string, plugins: unknown[], writeFail?: ModuleWriteFailMethod) {
    const result: T[] = [];
    for (const plugin of plugins.map(item => typeof item === 'string' ? [item] : Array.isArray(item) && typeof item[0] === 'string' ? item : null)) {
        if (plugin) {
            const packageName = plugin[0] as string;
            try {
                result.push(require(packageName)(plugin[1]));
            }
            catch (err) {
                if (writeFail) {
                    writeFail([`Install required? <npm i ${packageName}>`, name], err);
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