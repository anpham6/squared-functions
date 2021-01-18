import type { TransformOptions } from '../../types/lib/document';

export default async function transform(context: any, value: string, options: TransformOptions) {
    const { baseConfig, outputConfig, sourceMap, external } = options;
    Object.assign(baseConfig, outputConfig);
    if (external) {
        Object.assign(baseConfig, external);
    }
    let url: Undef<string>;
    if (baseConfig.sourceMap === false) {
        sourceMap.reset();
    }
    else if (baseConfig.sourceMap && typeof baseConfig.sourceMap === 'object' || sourceMap.map && (baseConfig.sourceMap = {})) {
        const mapConfig = baseConfig.sourceMap as PlainObject;
        if (sourceMap.map) {
            mapConfig.content = sourceMap.map;
        }
        mapConfig.asObject = true;
        if (mapConfig.url !== 'inline') {
            url = mapConfig.url as Undef<string>;
        }
    }
    delete baseConfig.name;
    const result = await context.minify(value, baseConfig);
    if (result) {
        if (result.map) {
            sourceMap.nextMap('terser', result.code, result.map, url);
        }
        return result.code;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}