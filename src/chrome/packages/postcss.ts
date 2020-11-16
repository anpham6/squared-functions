const context = require('postcss');

export default async function (value: string, options: PlainObject, config: PlainObject, sourceMap: Map<string, functions.internal.SourceMapOutput>) {
    const result = await context((options.plugins as string[] || []).map(item => require(item))).process(value, { from: '', to: '' });
    if (result) {
        if (result.map) {
            sourceMap.set('postcss', { value: result.css, map: result.map });
        }
        return result.css;
    }
}