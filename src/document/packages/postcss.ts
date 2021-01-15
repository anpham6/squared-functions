const context = require('postcss');

type TransformOutput = functions.Internal.Document.TransformOutput;

export default async function transform(value: string, options: PlainObject, output: TransformOutput) {
    const sourceMap = output.sourceMap;
    let includeSources = true,
        localUri: Undef<string>;
    if (sourceMap) {
        const { map, file } = sourceMap;
        localUri = file.localUri;
        if (options.map || map && (options.map = {})) {
            const optionsMap = options.map as StandardMap;
            optionsMap.prev = map;
            if (optionsMap.soucesContent === false) {
                includeSources = false;
            }
        }
    }
    const result = await context((options.plugins as string[] || []).map(item => require(item))).process(value, { from: localUri, to: localUri });
    if (result) {
        if (sourceMap && result.map) {
            sourceMap.nextMap('postcss', result.map, result.css, includeSources);
        }
        return result.css;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}