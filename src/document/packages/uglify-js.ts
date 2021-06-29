import type { SourceCode, TransformOptions } from '../../types/lib/document';

export default function transform(context: any, value: string, options: TransformOptions) {
    const { baseConfig, outputConfig, sourceMap, supplementChunks, createSourceMap, external } = options;
    Object.assign(baseConfig, outputConfig);
    if (external) {
        Object.assign(baseConfig, external);
    }
    let url: Undef<string>;
    if (baseConfig.sourceMap === false) {
        sourceMap.reset();
    }
    else if (baseConfig.sourceMap && typeof baseConfig.sourceMap === 'object' || sourceMap.map && (baseConfig.sourceMap = {})) {
        const map = baseConfig.sourceMap as PlainObject;
        if (sourceMap.map) {
            map.content = sourceMap.map;
        }
        map.asObject = true;
        if (map.url !== 'inline') {
            url = map.url as Undef<string>;
        }
    }
    delete baseConfig.name;
    if (supplementChunks) {
        for (const chunk of supplementChunks) {
            const chunkConfig = { ...baseConfig };
            if (typeof chunkConfig.sourceMap === 'object') {
                const map = chunk.sourceMap?.map;
                if (map) {
                    chunkConfig.sourceMap.content = map;
                }
                delete chunkConfig.sourceMap.url;
            }
            const result = context.minify(chunk.code, chunkConfig);
            if (result) {
                const { code, map } = result as SourceCode;
                chunk.code = code;
                if (map) {
                    (chunk.sourceMap ||= createSourceMap(code)).nextMap('uglify-js', code, map);
                }
                else {
                    chunk.sourceMap?.reset();
                }
            }
        }
    }
    const result = context.minify(value, baseConfig);
    if (result) {
        if (result.map) {
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