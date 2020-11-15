const context = require('clean-css');

export default async function (value: string, options: PlainObject, config: ObjectString, sourceMap: Map<string, functions.internal.SourceMapOutput>) {
    const result = new context(options).minify(value);
    if (result) {
        if (result.sourceMap) {
            sourceMap.set('clean-css', { value: result.styles, map: result.sourceMap.toString() });
        }
        return result.styles;
    }
}