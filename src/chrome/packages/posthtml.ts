const context = require('posthtml');

export default async function (value: string, options: PlainObject, config: PlainObject, sourceMap: Map<string, functions.internal.SourceMapOutput>) {
    const result = await context((options.plugins as [string, PlainObject][] || []).map(item => require(item[0])(item[1]))).process(value, config);
    if (result) {
        if (result.map) {
            sourceMap.set('posthtml', { value: result.html, map: result.map });
        }
        return result.html;
    }
}