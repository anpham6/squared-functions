const context = require('html-minifier-terser');

export default async function (value: string, options: ObjectString, config: ObjectString, outputMap: Map<string, ObjectString>) {
    const result = context.minify(value, options);
    if (result) {
        outputMap.set('html-minifier-terser', result);
        return result;
    }
}