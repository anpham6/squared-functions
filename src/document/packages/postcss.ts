import type { TransformOutput } from '../../types/lib/document';

import { loadPlugins } from '../util';

export default async function transform(context: any, value: string, output: TransformOutput) {
    const { baseConfig = {}, outputConfig = {}, sourceMap, external, writeFail } = output;
    let plugins: Undef<unknown[]> = baseConfig.plugins || outputConfig.plugins,
        sourceFile = output.sourceFile;
    delete baseConfig.plugins;
    delete outputConfig.plugins;
    Object.assign(baseConfig, outputConfig);
    if (external) {
        delete external.plugins;
        Object.assign(baseConfig, external);
    }
    if (sourceMap) {
        if (baseConfig.map === false) {
            sourceMap.reset();
        }
        else {
            sourceFile ||= output.file?.localUri;
            if (baseConfig.map && typeof baseConfig.map === 'object' || sourceMap.map && (baseConfig.map = {})) {
                baseConfig.map.prev = sourceMap.map;
            }
        }
    }
    if (Array.isArray(plugins)) {
        plugins = loadPlugins('postcss', plugins, writeFail);
        if (plugins.length) {
            Object.assign(baseConfig, { from: sourceFile, to: sourceFile });
            const result = await context().process(value, baseConfig);
            if (result) {
                if (sourceMap && result.map) {
                    sourceMap.nextMap('postcss', result.css, result.map);
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