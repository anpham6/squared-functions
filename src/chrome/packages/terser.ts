const context = require('terser');

export default async function (value: string, options: PlainObject) {
    return (await context.minify(value, options)).code;
}