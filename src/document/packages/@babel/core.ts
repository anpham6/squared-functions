const context = require('@babel/core');

type SourceMapInput = functions.internal.Document.SourceMapInput;

export default async function transform(value: string, options: PlainObject, output: Undef<PlainObject>, input: SourceMapInput) {
    const sourceMap = input.map;
    if (options.sourceMaps === true || sourceMap) {
        options.sourceMaps = true;
        options.inputSourceMap = sourceMap;
    }
    const result = await context.transform(value, options);
    if (result) {
        if (result.map) {
            input.nextMap('babel', result.map, result.code);
        }
        return result.code;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}