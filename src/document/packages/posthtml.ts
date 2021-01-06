type ModuleWriteFailMethod = functions.ModuleWriteFailMethod;

const context = require('posthtml');

function loadPlugins(plugins: [string, Undef<PlainObject>][], writeFail: ModuleWriteFailMethod) {
    const result: unknown[] = [];
    for (const plugin of plugins.map(item => typeof item === 'string' ? [item] : Array.isArray(item) && item.length ? item : null)) {
        if (plugin) {
            try {
                result.push(require(plugin[0])(plugin[1]));
            }
            catch (err) {
                writeFail([`Install required? [npm i ${plugin[0]}]`, 'posthtml'], err);
            }
        }
    }
    return result;
}

export default async function transform(value: string, options: PlainObject, output: Undef<PlainObject>, writeFail: ModuleWriteFailMethod) {
    if (Array.isArray(options.plugins)) {
        const plugins = loadPlugins(options.plugins, writeFail);
        if (plugins.length) {
            const result = await context(plugins).process(value, output);
            if (result) {
                return result.html;
            }
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}