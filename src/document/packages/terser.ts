const context = require('terser');

type SourceMapInput = functions.internal.Document.SourceMapInput;

export default async function transform(value: string, options: StandardMap, output: Undef<PlainObject>, input: SourceMapInput) {
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
    const result = await context.minify(value, options);
    if (result) {
        if (result.map) {
            input.nextMap('terser', result.map, result.code, includeSources);
        }
        return result.code;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}