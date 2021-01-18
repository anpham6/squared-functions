import type { TransformOptions } from '../../types/lib/document';

import type * as rollup from 'rollup';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');

import { loadPlugins } from '../util';

export default async function transform(context: any, value: string, options: TransformOptions<rollup.RollupOptions, rollup.OutputOptions>) {
    const { baseConfig, sourceMap, sourcesRelativeTo, external, writeFail } = options;
    let sourceFile = options.sourceFile,
        outputConfig = options.outputConfig,
        result = '',
        mappings = '';
    if (!sourceFile) {
        const rollupDir = path.join(process.cwd(), 'tmp' + path.sep + 'rollup');
        sourceFile = rollupDir + path.sep + uuid.v4();
        fs.mkdirpSync(rollupDir);
        fs.writeFileSync(sourceFile, value);
    }
    if (Object.keys(outputConfig).length === 0) {
        outputConfig = baseConfig.output as rollup.OutputOptions || { format: 'es' };
    }
    baseConfig.input = sourceFile;
    if (Array.isArray(baseConfig.plugins)) {
        baseConfig.plugins = loadPlugins<rollup.Plugin>('rollup', baseConfig.plugins, writeFail);
    }
    const bundle = await context.rollup(baseConfig) as rollup.RollupBuild;
    if (Array.isArray(outputConfig.plugins)) {
        outputConfig.plugins = loadPlugins<rollup.OutputPlugin>('rollup', outputConfig.plugins, writeFail);
    }
    if (external) {
        delete external.plugins;
        Object.assign(outputConfig, external);
    }
    if (sourcesRelativeTo) {
        outputConfig.sourcemapPathTransform = (relativeSourcePath, sourcemapPath) => path.resolve(path.dirname(sourcemapPath), relativeSourcePath);
    }
    let url: Undef<string>;
    if (outputConfig.sourcemap === false) {
        sourceMap.reset();
    }
    else {
        if (sourceMap.output.size) {
            outputConfig.sourcemap = true;
        }
        if (outputConfig.sourcemap && outputConfig.sourcemapFile) {
            url = path.basename(outputConfig.sourcemapFile);
        }
    }
    delete outputConfig.manualChunks;
    delete outputConfig.chunkFileNames;
    delete outputConfig.entryFileNames;
    const data = await bundle.generate(outputConfig);
    for (const item of data.output) {
        if (item.type === 'chunk') {
            result += item.code;
            if (item.map) {
                if (external && outputConfig.sourcemap === 'inline') {
                    result += `\n//# sourceMappingURL=${item.map.toUrl()}\n`;
                }
                mappings += item.map;
            }
        }
    }
    if (result) {
        if (mappings) {
            sourceMap.nextMap('rollup', result, mappings, url);
        }
        return result;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}