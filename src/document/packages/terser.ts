const context = require('terser');

type TransformOutput = functions.Internal.Document.TransformOutput;

export default async function transform(value: string, options: StandardMap, output: TransformOutput) {
    const { sourceMap, external } = output;
    let includeSources = true;
    if (sourceMap && (options.sourceMap && typeof options.sourceMap === 'object' || sourceMap.map && (options.sourceMap = {}))) {
        const map = options.sourceMap as PlainObject;
        map.content = sourceMap.map;
        map.asObject = true;
        if (map.url !== 'inline') {
            map.url = '';
        }
        if (map.includeSources === false) {
            includeSources = false;
        }
    }
    if (external) {
        Object.assign(options, external);
    }
    const result = await context.minify(value, options);
    if (result) {
        if (sourceMap && result.map) {
            sourceMap.nextMap('terser', result.map, result.code, includeSources);
        }
        return result.code;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}