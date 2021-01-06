const context = require('postcss');

type SourceMapInput = functions.internal.Document.SourceMapInput;

export default async function transform(value: string, options: PlainObject, output: Undef<PlainObject>, input: SourceMapInput) {
    const { map: sourceMap, file } = input;
    const fileUri = file.fileUri!;
    let includeSources = true;
    if (options.map || sourceMap && (options.map = {})) {
        const map = options.map as StandardMap;
        map.prev = sourceMap;
        if (map.soucesContent === false) {
            includeSources = false;
        }
    }
    const result = await context((options.plugins as string[] || []).map(item => require(item))).process(value, { from: fileUri, to: fileUri });
    if (result) {
        if (result.map) {
            input.nextMap('postcss', result.map, result.css, includeSources);
        }
        return result.css;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}