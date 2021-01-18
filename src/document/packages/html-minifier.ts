import type { TransformOptions } from '../../types/lib/document';

export default async function transform(context: any, value: string, options: TransformOptions) {
    const { baseConfig, outputConfig, external } = options;
    Object.assign(baseConfig, outputConfig);
    if (external) {
        Object.assign(baseConfig, external);
    }
    return context.minify(value, baseConfig);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}