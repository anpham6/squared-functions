import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');
import rollup = require('rollup');

type SourceMapInput = functions.internal.Chrome.SourceMapInput;
type RollupPlugins = [string, Undef<PlainObject>][];

function loadPlugins(plugins: RollupPlugins) {
    const result: rollup.OutputPlugin[] = [];
    for (const plugin of plugins.map(item => typeof item === 'string' ? [item] : Array.isArray(item) && item.length ? item : null)) {
        if (plugin) {
            try {
                result.push(require(plugin[0])(plugin[1]));
            }
            catch (err) {
                console.log(`rollup: Install required? [npm i ${plugin[0]}]` + err);
            }
        }
    }
    return result;
}

export default async function (value: string, options: rollup.RollupOptions, output: Undef<rollup.OutputOptions>, input: SourceMapInput) {
    if (!output) {
        output = options.output as rollup.OutputOptions || { format: 'es' };
    }
    const rollupDir = path.join(process.cwd(), 'temp' + path.sep + 'rollup');
    const inputFile = rollupDir + path.sep + uuid.v4();
    fs.mkdirpSync(rollupDir);
    fs.writeFileSync(inputFile, value);
    let result = '',
        mappings = '',
        includeSources = true;
    options.input = inputFile;
    if (Array.isArray(options.plugins)) {
        options.plugins = loadPlugins((options.plugins as unknown) as RollupPlugins);
    }
    const bundle = await rollup.rollup(options);
    if (!output.sourcemap && input.sourceMap) {
        output.sourcemap = true;
    }
    if (output.sourcemapExcludeSources) {
        includeSources = false;
    }
    if (Array.isArray(output.plugins)) {
        output.plugins = loadPlugins((options.plugins as unknown) as RollupPlugins);
    }
    delete output.manualChunks;
    delete output.chunkFileNames;
    delete output.entryFileNames;
    const data = await bundle.generate(output);
    for (const item of data.output) {
        if (item.type === 'chunk') {
            result += item.code;
            if (item.map) {
                mappings += item.map;
            }
        }
    }
    if (result) {
        if (mappings) {
            input.nextMap('rollup', mappings, result, includeSources);
        }
        return result;
    }
}