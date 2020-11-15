const context = require('html-minifier-terser');

export default async function (value: string, options: PlainObject) {
    return context.minify(value, options);
}