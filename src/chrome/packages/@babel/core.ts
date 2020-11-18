const context = require('@babel/core');

type SourceMapInput = functions.internal.Chrome.SourceMapInput;

export default async function (value: string, options: PlainObject, output: Undef<PlainObject>, input: SourceMapInput) {
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