const context = require('uglify-js');

export default async function (value: string, options: PlainObject) {
    return context.minify(value, options).code;
}