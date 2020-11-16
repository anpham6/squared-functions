const context = require('uglify-js');

type SourceMapOutput = functions.internal.SourceMapOutput;

export default async function (value: string, options: StandardMap, config: PlainObject, sourceMap: Map<string, SourceMapOutput>) {
    const map = options.sourceMap;
    let previousMap: Undef<[string, SourceMapOutput]>,
        filename: Undef<string>;
    if (map && typeof map === 'object') {
        map.asObject = false;
        if (sourceMap.size) {
            previousMap = Array.from(sourceMap).pop()!;
            map.content = previousMap[1].map;
        }
        filename = map.url;
    }
    const result = context.minify(value, options);
    if (result) {
        if (result.map) {
            if (previousMap) {
                sourceMap.delete(previousMap[0]);
            }
            sourceMap.set('uglify-js', { value: result.code, map: result.map, filename });
        }
        return result.code;
    }
}