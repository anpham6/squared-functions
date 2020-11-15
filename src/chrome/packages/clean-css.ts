const context = require('clean-css');

export default async function (value: string, options: ObjectString, config: ObjectString, outputMap: Map<string, ObjectString>) {
    const result = new context(options).minify(value);
    outputMap.set('clean-css', result);
    if (result) {
        return result.styles;
    }
}