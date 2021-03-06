import type { TransformOptions } from '../../types/lib/document';

export default function transform(context: any, value: string, options: TransformOptions) {
    const { baseConfig, outputConfig, supplementChunks, external } = options;
    Object.assign(baseConfig, outputConfig);
    if (external) {
        Object.assign(baseConfig, external);
    }
    let chunks: Undef<boolean>;
    switch (baseConfig.parser) {
        case 'babel':
        case 'babel-flow':
        case 'babel-ts':
        case 'json':
        case 'json-5':
        case 'json-stringify':
            baseConfig.plugins = [require('prettier/parser-babel')];
            chunks = true;
            break;
        case 'css':
        case 'scss':
        case 'less':
            baseConfig.plugins = [require('prettier/parser-postcss')];
            break;
        case 'flow':
            baseConfig.plugins = [require('prettier/parser-flow')];
            break;
        case 'html':
        case 'angular':
        case 'lwc':
        case 'vue':
            baseConfig.plugins = [require('prettier/parser-html')];
            break;
        case 'graphql':
            baseConfig.plugins = [require('prettier/parser-graphql')];
            break;
        case 'markdown':
            baseConfig.plugins = [require('prettier/parser-markdown')];
            break;
        case 'typescript':
            baseConfig.plugins = [require('prettier/parser-typescript')];
            break;
        case 'yaml':
            baseConfig.plugins = [require('prettier/parser-yaml')];
            break;
        default:
            return;
    }
    if (supplementChunks && chunks) {
        for (const chunk of supplementChunks) {
            const result = context.format(value, { ...baseConfig });
            if (result) {
                chunk.code = result;
            }
        }
    }
    return context.format(value, baseConfig);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}