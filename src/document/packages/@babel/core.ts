import type { TransformOutput } from '../../../types/lib/document';

export default async function transform(context: any, value: string, output: TransformOutput) {
    const { baseConfig = {}, outputConfig = {}, sourceMap, external } = output;
    Object.assign(baseConfig, outputConfig);
    if (external) {
        Object.assign(baseConfig, external);
    }
    if (sourceMap) {
        if (baseConfig.sourceMaps === false) {
            sourceMap.output.clear();
        }
        else if (sourceMap.map) {
            baseConfig.sourceMaps = true;
            baseConfig.inputSourceMap = sourceMap.map;
        }
    }
    const result = await context.transform(value, baseConfig);
    if (result) {
        if (sourceMap && result.map) {
            sourceMap.nextMap('babel', result.code, result.map);
        }
        return result.code;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}