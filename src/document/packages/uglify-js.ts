import type { TransformOutput } from '../../types/lib/document';

export default async function transform(context: any, value: string, output: TransformOutput) {
    const { baseConfig = {}, outputConfig = {}, sourceMap, external } = output;
    Object.assign(baseConfig, outputConfig);
    if (external) {
        Object.assign(baseConfig, external);
    }
    let url: Undef<string>;
    if (baseConfig.sourceMap === false) {
        if (sourceMap) {
            sourceMap.reset();
        }
    }
    else if (baseConfig.sourceMap && typeof baseConfig.sourceMap === 'object' || sourceMap && sourceMap.map && (baseConfig.sourceMap = {})) {
        const mapConfig = baseConfig.sourceMap as PlainObject;
        if (sourceMap) {
            mapConfig.content = sourceMap.map;
        }
        mapConfig.asObject = true;
        if (mapConfig.url !== 'inline') {
            url = mapConfig.url as Undef<string>;
        }
    }
    delete baseConfig.name;
    const result = context.minify(value, baseConfig);
    if (result) {
        if (sourceMap && result.map) {
            sourceMap.nextMap('uglify-js', result.code, result.map, url);
        }
        return result.code;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}