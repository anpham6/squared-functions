const context = require('clean-css');

type SourceMapInput = functions.internal.Chrome.SourceMapInput;

export default async function (value: string, options: PlainObject, config: PlainObject, input: SourceMapInput) {
    const sourceMap = input.map;
    if (sourceMap) {
        options.sourceMap = true;
    }
    const result = new context(options).minify(value, sourceMap);
    if (result) {
        if (result.sourceMap) {
            input.nextMap('clean-css', result.sourceMap, result.styles);
        }
        return result.styles;
    }
}