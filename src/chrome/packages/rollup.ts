import type { MergedRollupOptions } from 'rollup';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');
import rollup = require('rollup');

type SourceMapInput = functions.internal.Chrome.SourceMapInput;

export default async function (value: string, options: ObjectString, config: ObjectString, input: SourceMapInput) {
    const rollupDir = path.join(process.cwd(), 'temp' + path.sep + 'rollup');
    const inputFile = rollupDir + path.sep + uuid.v4();
    fs.mkdirpSync(rollupDir);
    fs.writeFileSync(inputFile, value);
    let result = '',
        mappings = '',
        includeSources = true;
    const appendOutput = (data: rollup.RollupOutput) => {
        for (const item of data.output) {
            if (item.type === 'chunk') {
                result += item.code;
                if (item.map) {
                    mappings += item.map;
                }
            }
        }
    };
    if (typeof options === 'string') {
        const fileUri = path.resolve(options);
        if (fs.existsSync(fileUri)) {
            await require('rollup/dist/loadConfigFile')(fileUri, config)
                .then(async (merged: StandardMap) => {
                    merged.warnings.flush();
                    for (const rollupOptions of merged.options as MergedRollupOptions[]) {
                        rollupOptions.input = inputFile;
                        const bundle = await rollup.rollup(rollupOptions);
                        for (const item of rollupOptions.output) {
                            if (input.sourceMap && !item.sourcemap) {
                                item.sourcemap = true;
                            }
                            if (item.sourcemapExcludeSources) {
                                includeSources = false;
                            }
                            appendOutput(await bundle.generate(item));
                        }
                    }
                });
        }
    }
    else {
        options.input = inputFile;
        const outputOptions = typeof config === 'object' && Object.keys(config).length ? config : options;
        const bundle = await rollup.rollup(options);
        if (input.sourceMap && !outputOptions.sourcemap) {
            outputOptions.sourcemap = true;
        }
        if (outputOptions.sourcemapExcludeSources) {
            includeSources = false;
        }
        const data = await bundle.generate(outputOptions);
        appendOutput(data);
    }
    if (result) {
        if (mappings) {
            input.nextMap('rollup', mappings, result, includeSources);
        }
        return result;
    }
}