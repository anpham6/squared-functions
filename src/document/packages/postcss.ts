const context = require('postcss');

type TransformOutput = functions.Internal.Document.TransformOutput;

export default async function transform(value: string, options: PlainObject, output: TransformOutput) {
    const { sourceMap, external } = output;
    let includeSources = true,
        localUri: Undef<string>;
    if (sourceMap) {
        const { map, file } = sourceMap;
        if (file) {
            localUri = file.localUri;
        }
        if (options.map || map && (options.map = {})) {
            const optionsMap = options.map as StandardMap;
            optionsMap.prev = map;
            if (optionsMap.soucesContent === false) {
                includeSources = false;
            }
        }
    }
    const config: PlainObject = Object.assign(output.config || {}, { from: localUri, to: localUri });
    if (external) {
        Object.assign(config, external);
    }
    const result = await context((options.plugins as string[] || []).map(item => require(item))).process(value, config);
    if (result) {
        if (sourceMap && result.map) {
            sourceMap.nextMap('postcss', result.map, result.css, includeSources);
        }
        return result.css;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}