import type { MergedRollupOptions, OutputOptions } from 'rollup';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');
import rollup = require('rollup');

export default async function (value: string, options: ObjectString, config: ObjectString, outputMap: Map<string, ObjectString>) {
    const rollupDir = path.join(process.cwd(), 'temp' + path.sep + 'rollup');
    const inputFile = rollupDir + path.sep + uuid.v4();
    fs.mkdirpSync(rollupDir);
    fs.writeFileSync(inputFile, value);
    const es: OutputOptions = { format: 'es' };
    const items: rollup.RollupOutput[] = [];
    let result = '';
    const appendOutput = (data: rollup.RollupOutput) => {
        for (const item of data.output) {
            if (item.type === 'chunk') {
                result += item.code;
            }
        }
        items.push(data);
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
                            appendOutput(await bundle.generate(item));
                        }
                    }
                });
        }
    }
    else {
        options.input = inputFile;
        const bundle = await rollup.rollup(options);
        const data = await bundle.generate(typeof config === 'object' ? Object.assign(config, es) : Object.assign(options, es));
        appendOutput(data);
    }
    if (result) {
        outputMap.set('rollup', { output: items });
        return result;
    }
}