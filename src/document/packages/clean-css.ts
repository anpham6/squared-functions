const context = require('clean-css');

type TransformOutput = functions.Internal.Document.TransformOutput;
type SourceMap = functions.Internal.Document.SourceMap;

export default async function transform(value: string, options: PlainObject, output: TransformOutput) {
    const { sourceMap, external } = output;
    let map: Undef<SourceMap>;
    if (sourceMap) {
        map = sourceMap.map;
        if (map) {
            options.sourceMap = true;
        }
    }
    if (external) {
        Object.assign(options, external);
    }
    const result = new context(options).minify(value, map);
    if (result) {
        if (sourceMap && result.sourceMap) {
            sourceMap.nextMap('clean-css', result.sourceMap, result.styles);
        }
        return result.styles;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}