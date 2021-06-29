import type { SourceMapInput, TransformOptions } from '../../types/lib/document';

import type * as rollup from 'rollup';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');

import { loadPlugins } from '../util';

export default async function transform(context: any, value: string, options: TransformOptions<rollup.RollupOptions, rollup.OutputOptions>) {
    let { sourceFile, outputConfig, mimeType, baseConfig, sourceMap, sourcesRelativeTo, external, supplementChunks, createSourceMap, writeFail } = options, // eslint-disable-line prefer-const
        tempFile = false,
        result = '',
        mappings = '';
    if (!sourceFile) {
        const rollupDir = path.join(process.cwd(), 'tmp' + path.sep + 'rollup');
        sourceFile = rollupDir + path.sep + uuid.v4();
        fs.mkdirpSync(rollupDir);
        fs.writeFileSync(sourceFile, value);
        tempFile = true;
    }
    if (Object.keys(outputConfig).length === 0) {
        outputConfig = baseConfig.output as rollup.OutputOptions || { format: mimeType === 'application/javascript' ? 'es' : 'iife' };
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
    if (!supplementChunks || external) {
        delete outputConfig.manualChunks;
        delete outputConfig.chunkFileNames;
        delete outputConfig.entryFileNames;
        outputConfig.preserveModules = false;
    }
    const data = await bundle.generate(outputConfig);
    const items = data.output;
    for (let i = 0, j = 0; i < items.length; ++i) {
        const item = items[i];
        if (item.type === 'chunk') {
            const code = item.code;
            if (!supplementChunks || external || j++ === 0) {
                result += code;
                if (item.map) {
                    if (external && outputConfig.sourcemap === 'inline') {
                        result += `\n//# sourceMappingURL=${item.map.toUrl()}\n`;
                    }
                    else {
                        mappings += item.map;
                    }
                }
            }
            else {
                let chunkMap: Undef<SourceMapInput>;
                if (item.map) {
                    chunkMap = createSourceMap(code);
                    chunkMap.nextMap('rollup', code, item.map);
                }
                supplementChunks.push({
                    code,
                    sourceMap: chunkMap,
                    filename: path.basename(item.fileName)
                });
            }
        }
    }
    if (result) {
        if (mappings) {
            sourceMap.nextMap('rollup', result, mappings, url, tempFile);
        }
        return result;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = transform;
    module.exports.default = transform;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}