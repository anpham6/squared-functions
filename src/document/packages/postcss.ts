const context = require('postcss');

type SourceMapInput = functions.Internal.Document.SourceMapInput;

export default async function transform(value: string, options: PlainObject, output?: PlainObject, input?: SourceMapInput) {
    let includeSources = true,
        localUri: Undef<string>;
    if (input) {
        const { map: sourceMap, file } = input;
        localUri = file.localUri;
        if (options.map || sourceMap && (options.map = {})) {
            const map = options.map as StandardMap;
            map.prev = sourceMap;
            if (map.soucesContent === false) {
                includeSources = false;
            }
        }
    }
    const result = await context((options.plugins as string[] || []).map(item => require(item))).process(value, { from: localUri, to: localUri });
    if (result) {
        if (input && result.map) {
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