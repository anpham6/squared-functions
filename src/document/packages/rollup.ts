import type * as rollup from 'rollup';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');

import { loadPlugins } from '../util';

type RollupPlugins = [string, Undef<PlainObject>][];

export default async function transform(context: any, value: string, output: functions.Internal.Document.TransformOutput<rollup.RollupOptions, rollup.OutputOptions>) {
    const { baseConfig = {}, outputConfig = baseConfig.output as rollup.OutputOptions || { format: 'es' }, sourceMap, sourcesRelativeTo, external, writeFail } = output;
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
    baseConfig.input = sourceFile;
    let plugins = (baseConfig.plugins as unknown) as RollupPlugins;
    if (Array.isArray(plugins)) {
        baseConfig.plugins = loadPlugins<rollup.Plugin>('rollup', plugins, writeFail);
    }
    const bundle = await context.rollup(baseConfig) as rollup.RollupBuild;
    plugins = (outputConfig.plugins as unknown) as RollupPlugins;
    if (Array.isArray(plugins)) {
        outputConfig.plugins = loadPlugins<rollup.OutputPlugin>('rollup', plugins, writeFail);
    }
    if (external) {
        delete external.plugins;
        Object.assign(outputConfig, external);
    }
    if (sourcesRelativeTo) {
        outputConfig.sourcemapPathTransform = (relativeSourcePath, sourcemapPath) => path.resolve(path.dirname(sourcemapPath), relativeSourcePath);
    }
    if (sourceMap) {
        if (outputConfig.sourcemap === false) {
            sourceMap.output.clear();
        }
        else if (sourceMap.output.size) {
            outputConfig.sourcemap = true;
        }
    }
    if (outputConfig.sourcemapExcludeSources) {
        includeSources = false;
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
                else if (sourceMap) {
                    mappings += item.map;
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