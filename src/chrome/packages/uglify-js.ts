const context = require('uglify-js');

type SourceMapInput = functions.internal.Chrome.SourceMapInput;

export default async function (value: string, options: StandardMap, output: Undef<PlainObject>, input: SourceMapInput) {
    let includeSources = true;
    if (options.sourceMap && typeof options.sourceMap === 'object' || input.map && (options.sourceMap = {})) {
        const sourceMap = options.sourceMap;
        sourceMap.content = input.map;
        sourceMap.asObject = true;
        sourceMap.url = '';
        if (sourceMap.includeSources === false) {
            includeSources = false;
        }
    }
    const result = context.minify(value, options);
    if (result) {
        if (result.map) {
            input.nextMap('uglify-js', result.map, result.code, includeSources);
        }
        return result.code;
    }
}