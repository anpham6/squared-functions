type TransformOutput = functions.Internal.Document.TransformOutput;

export default async function transform(context: any, value: string, output: TransformOutput) {
    const { baseConfig = {}, outputConfig = {}, sourceMap, external } = output;
    Object.assign(baseConfig, outputConfig);
    let includeSources = true;
    if (baseConfig.sourceMap && typeof baseConfig.sourceMap === 'object' || sourceMap && sourceMap.map && (baseConfig.sourceMap = {})) {
        const mapConfig = baseConfig.sourceMap as PlainObject;
        if (sourceMap) {
            mapConfig.content = sourceMap.map;
        }
        mapConfig.asObject = true;
        if (mapConfig.url !== 'inline') {
            mapConfig.url = '';
        }
        if (mapConfig.includeSources === false) {
            includeSources = false;
        }
    }
    if (external) {
        Object.assign(baseConfig, external);
    }
    const result = await context.minify(value, baseConfig);
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