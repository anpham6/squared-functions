const context = require('uglify-js');

type SourceMapInput = functions.internal.Chrome.SourceMapInput;

export default async function (value: string, options: StandardMap, config: PlainObject, input: SourceMapInput) {
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
    const result = context.minify(value, options);
    if (result) {
        if (result.map) {
            input.nextMap('uglify-js', result.map, result.code, includeSources, url);
        }
        return result.code;
    }
}