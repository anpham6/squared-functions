import { loadPlugins } from '../util';

type TransformOutput = functions.Internal.Document.TransformOutput;

export default async function transform(context: any, value: string, output: TransformOutput) {
    const { baseConfig = {}, outputConfig = {}, external, writeFail } = output;
    let plugins: Undef<any[]> = baseConfig.plugins || outputConfig.plugins;
    if (Array.isArray(plugins)) {
        plugins = loadPlugins('posthtml', baseConfig.plugins, writeFail);
        if (plugins.length) {
            delete baseConfig.plugins;
            delete outputConfig.plugins;
            Object.assign(baseConfig, outputConfig);
            if (external) {
                Object.assign(baseConfig, external);
            }
            const result = await context(plugins).process(value, baseConfig);
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