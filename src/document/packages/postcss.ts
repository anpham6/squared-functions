import { loadPlugins } from '../util';

type TransformOutput = functions.Internal.Document.TransformOutput;

export default async function transform(context: any, value: string, output: TransformOutput) {
    const { baseConfig = {}, outputConfig = {}, sourceMap, external, writeFail } = output;
    let includeSources = true,
        localUri: Undef<string>;
    if (sourceMap) {
        const { map, file } = sourceMap;
        if (file) {
            localUri = file.localUri;
        }
        if (baseConfig.map || map && (baseConfig.map = {})) {
            const optionsMap = baseConfig.map as StandardMap;
            optionsMap.prev = map;
            if (optionsMap.soucesContent === false) {
                includeSources = false;
            }
        }
    }
    let plugins: Undef<any[]> = baseConfig.plugins || outputConfig.plugins;
    if (Array.isArray(plugins)) {
        plugins = loadPlugins('postcss', plugins, writeFail);
        if (plugins.length) {
            delete baseConfig.plugins;
            delete outputConfig.plugins;
            Object.assign(baseConfig, outputConfig, { from: localUri, to: localUri });
            if (external) {
                Object.assign(baseConfig, external);
            }
            const result = await context().process(value, baseConfig);
            if (result) {
                if (sourceMap && result.map) {
                    sourceMap.nextMap('postcss', result.map, result.css, includeSources);
                }
                return result.css;
            }
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}