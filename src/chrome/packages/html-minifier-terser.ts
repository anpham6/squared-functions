const context = require('html-minifier-terser');

export default async function transform(value: string, options: PlainObject) {
    return context.minify(value, options);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}