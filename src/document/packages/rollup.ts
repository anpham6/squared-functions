import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');
import rollup = require('rollup');

type TransformOutput = functions.Internal.Document.TransformOutput;
type ModuleWriteFailMethod = functions.ModuleWriteFailMethod;
type RollupPlugins = [string, Undef<PlainObject>][];

function loadPlugins(plugins: RollupPlugins, writeFail?: ModuleWriteFailMethod) {
    const result: rollup.OutputPlugin[] = [];
    for (const plugin of plugins.map(item => typeof item === 'string' ? [item] : Array.isArray(item) && item.length ? item : null)) {
        if (plugin) {
            try {
                result.push(require(plugin[0])(plugin[1]));
            }
            catch (err) {
                if (writeFail) {
                    writeFail([`Install required? <npm i ${plugin[0]}>`, 'rollup'], err);
                }
            }
        }
    }
    return result;
}

export default async function transform(value: string, options: rollup.RollupOptions, output: TransformOutput) {
    const { sourceMap, external, writeFail } = output;
    const outputOptions = Object.assign(options.output || { format: 'es' }, output.config) as rollup.OutputOptions;
    let sourceFile = output.sourceFile,
        result = '',
        mappings = '',
        includeSources = true;
    if (!sourceFile) {
        const rollupDir = path.join(process.cwd(), 'tmp' + path.sep + 'rollup');
        sourceFile = rollupDir + path.sep + uuid.v4();
        fs.mkdirpSync(rollupDir);
        fs.writeFileSync(sourceFile, value);
    }
    options.input = sourceFile;
    if (Array.isArray(options.plugins)) {
        options.plugins = loadPlugins((options.plugins as unknown) as RollupPlugins, writeFail);
    }
    const bundle = await rollup.rollup(options);
    if (!outputOptions.sourcemap && sourceMap && sourceMap.output.size) {
        outputOptions.sourcemap = true;
    }
    if (outputOptions.sourcemapExcludeSources) {
        includeSources = false;
    }
    if (Array.isArray(outputOptions.plugins)) {
        outputOptions.plugins = loadPlugins((options.plugins as unknown) as RollupPlugins, writeFail);
    }
    if (external) {
        Object.assign(outputOptions, external);
    }
    delete outputOptions.manualChunks;
    delete outputOptions.chunkFileNames;
    delete outputOptions.entryFileNames;
    const data = await bundle.generate(outputOptions);
    for (const item of data.output) {
        if (item.type === 'chunk') {
            result += item.code;
            if (item.map) {
                if (sourceMap) {
                    mappings += item.map;
                }
                else if (external && outputOptions.sourcemap === 'inline') {
                    result += `\n//# sourceMappingURL=${item.map.toUrl()}\n`;
                }
            }
        }
    }
    if (result) {
        if (sourceMap && mappings) {
            sourceMap.nextMap('rollup', mappings, result, includeSources);
        }
        return result;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}