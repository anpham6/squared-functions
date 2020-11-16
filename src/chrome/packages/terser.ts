const context = require('terser');

type SourceMapInput = functions.internal.Chrome.SourceMapInput;

export default async function (value: string, options: StandardMap, output: Undef<PlainObject>, input: SourceMapInput) {
    let includeSources = true,
        url: Undef<string>;
    if (options.sourceMap && typeof options.sourceMap === 'object' || input.map && (options.sourceMap = {})) {
        const sourceMap = options.sourceMap;
        sourceMap.content = input.map;
        sourceMap.asObject = true;
        if (sourceMap.includeSources === false) {
            includeSources = false;
        }
        url = sourceMap.url;
    }
    const result = await context.minify(value, options);
    if (result) {
        if (result.map) {
            input.nextMap('terser', result.map, result.code, includeSources, url);
        }
        return result.code;
    }
}