const context = require('@babel/core');

export default async function (value: string, options: PlainObject, config: ObjectString, sourceMap: Map<string, functions.internal.SourceMapOutput>) {
    const result = context.transform(value, options);
    if (result) {
        if (result.map && result.map.mappings) {
            sourceMap.set('babel', { value: result.code, map: result.map.mappings });
        }
        return result.code;
    }
}