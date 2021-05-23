import type { SourceMap, TransformOptions } from '../../types/lib/document';

export default function transform(context: any, value: string, options: TransformOptions) {
    const { baseConfig, outputConfig, sourceMap, external } = options;
    Object.assign(baseConfig, outputConfig);
    if (external) {
        Object.assign(baseConfig, external);
    }
    let map: Undef<SourceMap>;
    if (baseConfig.sourceMap === false) {
        sourceMap.reset();
    }
    else if (map = sourceMap.map) {
        baseConfig.sourceMap = true;
    }
    const result = new context(baseConfig).minify(value, map);
    if (result) {
        if (result.sourceMap) {
            sourceMap.nextMap('clean-css', result.styles, result.sourceMap);
        }
        return result.styles;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}