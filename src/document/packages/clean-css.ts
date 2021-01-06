const context = require('clean-css');

type SourceMapInput = functions.internal.Document.SourceMapInput;

export default async function transform(value: string, options: PlainObject, output: Undef<PlainObject>, input: SourceMapInput) {
    const sourceMap = input.map;
    if (sourceMap) {
        options.sourceMap = true;
    }
    const result = new context(options).minify(value, sourceMap);
    if (result) {
        if (result.sourceMap) {
            input.nextMap('clean-css', result.sourceMap, result.styles);
        }
        return result.styles;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}