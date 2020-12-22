const context = require('posthtml');

function loadPlugins(plugins: [string, Undef<PlainObject>][]) {
    const result: unknown[] = [];
    for (const plugin of plugins.map(item => typeof item === 'string' ? [item] : Array.isArray(item) && item.length ? item : null)) {
        if (plugin) {
            try {
                result.push(require(plugin[0])(plugin[1]));
            }
            catch (err) {
                console.log(`posthtml: Install required? [npm i ${plugin[0]}]` + err);
            }
        }
    }
    return result;
}

export default async function transform(value: string, options: PlainObject, output: Undef<PlainObject>) {
    if (Array.isArray(options.plugins)) {
        const plugins = loadPlugins(options.plugins);
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