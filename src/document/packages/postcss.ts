import type { TransformOptions } from '../../types/lib/document';

import { loadPlugins } from '../util';

export default async function transform(context: any, value: string, options: TransformOptions) {
    const { baseConfig, outputConfig, sourceMap, external, writeFail } = options;
    let plugins: Undef<unknown[]> = baseConfig.plugins || outputConfig.plugins,
        sourceFile = options.sourceFile;
    delete baseConfig.plugins;
    delete outputConfig.plugins;
    Object.assign(baseConfig, outputConfig);
    if (external) {
        delete external.plugins;
        Object.assign(baseConfig, external);
    }
    if (baseConfig.map === false) {
        sourceMap.reset();
    }
    else {
        sourceFile ||= options.file?.localUri;
        if (sourceMap.map) {
            (baseConfig.map ||= {}).prev = sourceMap.map;
        }
    }
    if (Array.isArray(plugins)) {
        plugins = loadPlugins('postcss', plugins, writeFail);
        if (plugins.length) {
            Object.assign(baseConfig, { from: sourceFile, to: sourceFile });
            const result = await context().process(value, baseConfig);
            if (result) {
                if (result.map) {
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