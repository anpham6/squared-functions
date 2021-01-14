const context = require('terser');

type SourceMapInput = functions.Internal.Document.SourceMapInput;

export default async function transform(value: string, options: StandardMap, output?: PlainObject, input?: SourceMapInput) {
    let includeSources = true;
    if (input && (options.sourceMap && typeof options.sourceMap === 'object' || input.map && (options.sourceMap = {}))) {
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
        if (input && result.map) {
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