import type { MergedRollupOptions, OutputAsset, OutputChunk, OutputOptions } from 'rollup';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');
import rollup = require('rollup');

export default async function (value: string, options: PlainObject, config: PlainObject | string) {
    const rollupDir = path.join(process.cwd(), 'temp' + path.sep + 'rollup');
    const inputFile = rollupDir + path.sep + uuid.v4();
    fs.mkdirpSync(rollupDir);
    fs.writeFileSync(inputFile, value);
    let result = '';
    const es: OutputOptions = { format: 'es' };
    const appendOutput = (output: (OutputChunk | OutputAsset)[]) => {
        for (const item of output) {
            if (item.type === 'chunk') {
                result += item.code;
            }
        }
    };
    if (typeof options === 'string') {
        const fileUri = path.resolve(options);
        if (fs.existsSync(fileUri)) {
            await require('rollup/dist/loadConfigFile')(fileUri, es)
                .then(async (merged: StandardMap) => {
                    merged.warnings.flush();
                    for (const rollupOptions of merged.options as MergedRollupOptions[]) {
                        rollupOptions.input = inputFile;
                        const bundle = await rollup.rollup(rollupOptions);
                        for (const item of rollupOptions.output) {
                            const { output } = await bundle.generate(item);
                            appendOutput(output);
                        }
                    }
                });
        }
    }
    else if (typeof options === 'object') {
        options.input = inputFile;
        const bundle = await rollup.rollup(options);
        const { output } = await bundle.generate(typeof config === 'object' ? Object.assign(config, es) : Object.assign(options, es));
        appendOutput(output);
    }
    return result;
}