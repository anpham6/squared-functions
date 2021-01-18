import path = require('path');

import type { TransformOptions } from '../../../types/lib/document';

export default async function transform(context: any, value: string, options: TransformOptions) {
    const { baseConfig, outputConfig, sourceMap, external } = options;
    Object.assign(baseConfig, outputConfig);
    if (external) {
        Object.assign(baseConfig, external);
    }
    let url: Undef<string>;
    if (baseConfig.sourceMaps === false) {
        sourceMap.reset();
    }
    else {
        if (sourceMap.map) {
            baseConfig.sourceMaps = true;
            baseConfig.inputSourceMap = sourceMap.map;
        }
        if (baseConfig.sourceMaps && baseConfig.sourceFileName) {
            url = path.basename(baseConfig.sourceFileName);
        }
    }
    const result = await context.transform(value, baseConfig);
    if (result) {
        if (result.map) {
            sourceMap.nextMap('babel', result.code, result.map, url);
        }
        return result.code;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}