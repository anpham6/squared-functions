const context = require('terser');

export default async function (value: string, options: ObjectString, config: ObjectString, outputMap: Map<string, ObjectString>) {
    const result = await context.minify(value, options);
    if (result) {
        outputMap.set('terser', result);
        return result.code;
    }
}