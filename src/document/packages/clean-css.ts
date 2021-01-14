const context = require('clean-css');

type SourceMap = functions.Internal.Document.SourceMap;
type SourceMapInput = functions.Internal.Document.SourceMapInput;

export default async function transform(value: string, options: PlainObject, output?: PlainObject, input?: SourceMapInput) {
    let sourceMap: Undef<SourceMap>;
    if (input) {
        sourceMap = input.map;
        if (sourceMap) {
            options.sourceMap = true;
        }
    }
    const result = new context(options).minify(value, sourceMap);
    if (result) {
        if (input && result.sourceMap) {
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