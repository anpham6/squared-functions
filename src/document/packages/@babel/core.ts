const context = require('@babel/core');

type TransformOutput = functions.Internal.Document.TransformOutput;

export default async function transform(value: string, options: PlainObject, output: TransformOutput) {
    const sourceMap = output.sourceMap;
    if (sourceMap) {
        if (options.sourceMaps === true || sourceMap.map) {
            options.sourceMaps = true;
            options.inputSourceMap = sourceMap.map;
        }
    }
    const result = await context.transform(value, options);
    if (result) {
        if (sourceMap && result.map) {
            sourceMap.nextMap('babel', result.map, result.code);
        }
        return result.code;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}