const context = require('clean-css');

export default async function (value: string, options: PlainObject) {
    return new context(options).minify(value).styles;
}