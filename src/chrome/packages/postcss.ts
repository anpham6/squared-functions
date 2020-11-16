const context = require('postcss');

type SourceMapInput = functions.internal.Chrome.SourceMapInput;

export default async function (value: string, options: PlainObject, config: PlainObject, input: SourceMapInput) {
    const { map: sourceMap, fileUri } = input;
    let includeSources = true;
    if (options.map || sourceMap && (options.map = {})) {
        const map = options.map as StandardMap;
        map.prev = sourceMap;
        if (map.soucesContent === false) {
            includeSources = false;
        }
    }
    const result = await context((options.plugins as string[] || []).map(item => require(item))).process(value, { from: fileUri, to: fileUri });
    if (result) {
        if (result.map) {
            input.nextMap('postcss', result.map, result.css, includeSources);
        }
        return result.css;
    }
}