const context = require('posthtml');

type TransformOutput = functions.Internal.Document.TransformOutput;
type ModuleWriteFailMethod = functions.ModuleWriteFailMethod;

function loadPlugins(plugins: [string, Undef<PlainObject>][], writeFail?: ModuleWriteFailMethod) {
    const result: unknown[] = [];
    for (const plugin of plugins.map(item => typeof item === 'string' ? [item] : Array.isArray(item) && item.length ? item : null)) {
        if (plugin) {
            try {
                result.push(require(plugin[0])(plugin[1]));
            }
            catch (err) {
                if (writeFail) {
                    writeFail([`Install required? <npm i ${plugin[0]}>`, 'posthtml'], err);
                }
            }
        }
    }
    return result;
}

export default async function transform(value: string, options: PlainObject, output: TransformOutput) {
    const { config = {}, external, writeFail } = output;
    if (Array.isArray(options.plugins)) {
        const plugins = loadPlugins(options.plugins, writeFail);
        if (plugins.length) {
            if (external) {
                Object.assign(config, external);
            }
            const result = await context(plugins).process(value, config);
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