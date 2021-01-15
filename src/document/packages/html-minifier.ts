const context = require('html-minifier');

type TransformOutput = functions.Internal.Document.TransformOutput;

export default async function transform(value: string, options: PlainObject, output: TransformOutput) {
    if (output.external) {
        Object.assign(options, output.external);
    }
    return context.minify(value, options);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}