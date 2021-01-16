type TransformOutput = functions.Internal.Document.TransformOutput;
type SourceMap = functions.Internal.Document.SourceMap;

export default async function transform(context: any, value: string, output: TransformOutput) {
    const { baseConfig = {}, outputConfig = {}, sourceMap, external } = output;
    Object.assign(baseConfig, outputConfig);
    if (external) {
        Object.assign(baseConfig, external);
    }
    let map: Undef<SourceMap>;
    if (sourceMap) {
        if (baseConfig.sourceMap === false) {
            sourceMap.output.clear();
        }
        else if (sourceMap.map) {
            map = sourceMap.map;
            baseConfig.sourceMap = true;
        }
    }
    const result = new context(baseConfig).minify(value, map);
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