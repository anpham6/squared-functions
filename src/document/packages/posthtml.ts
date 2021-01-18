import type { TransformOptions } from '../../types/lib/document';

import { loadPlugins } from '../util';

export default async function transform(context: any, value: string, options: TransformOptions) {
    const { baseConfig, outputConfig, external, writeFail } = options;
    let plugins: Undef<unknown[]> = baseConfig.plugins || outputConfig.plugins;
    if (Array.isArray(plugins)) {
        plugins = loadPlugins('posthtml', plugins, writeFail);
        if (plugins.length) {
            delete baseConfig.plugins;
            delete outputConfig.plugins;
            Object.assign(baseConfig, outputConfig);
            if (external) {
                delete external.plugins;
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