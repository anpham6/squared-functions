const context = require('uglify-js');

export default async function (value: string, options: ObjectString, config: ObjectString, outputMap: Map<string, ObjectString>) {
    const result = context.minify(value, options);
    if (result) {
        outputMap.set('uglify-js', result);
        return result.code;
    }
}