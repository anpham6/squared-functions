import type { SourceMapInput, TransformOptions } from '../../types/lib/document';

import type * as rollup from 'rollup';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');

import { loadPlugins } from '../util';

export default async function transform(context: any, value: string, options: TransformOptions<rollup.RollupOptions, rollup.OutputOptions>) {
    let { sourceFile, outputConfig, mimeType, baseConfig, sourceMap, sourcesRelativeTo, getSourceFiles, external, supplementChunks, createSourceMap, writeFail } = options, // eslint-disable-line prefer-const
        result = '',
        mappings = '',
        tempFile: Undef<boolean>,
        inputFile: Undef<[string, string?][]>;
    const createDir = () => {
        const tempDir = path.join(process.cwd(), 'tmp', 'rollup');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirpSync(tempDir);
        }
        return tempDir;
    };
    const format = mimeType === 'application/javascript' ? 'es' : 'iife';
    if (Object.keys(outputConfig).length === 0) {
        outputConfig = baseConfig.output as rollup.OutputOptions || { format };
    }
    outputConfig.format ||= format as rollup.ModuleFormat;
    const notModule = outputConfig.format === 'iife' || outputConfig.format === 'umd';
    if (!notModule && supplementChunks && getSourceFiles && ({ sourceFile: inputFile, sourcesRelativeTo } = getSourceFiles()) && inputFile) {
        const files: string[] = [];
        const tempDir = createDir();
        for (let [pathname, content] of inputFile) { // eslint-disable-line prefer-const
            if (!pathname) {
                if (content) {
                    fs.writeFileSync(pathname = path.join(tempDir, uuid.v4()), content);
                    tempFile = true;
                }
                else {
                    continue;
                }
            }
            files.push(pathname);
        }
        baseConfig.input = files;
    }
    else if (!sourceFile || notModule) {
        fs.writeFileSync(baseConfig.input = path.join(createDir(), uuid.v4()), value);
        tempFile = true;
    }
    else {
        baseConfig.input = sourceFile;
    }
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
    const data = await bundle.generate(outputConfig);
    const items = data.output as rollup.RenderedChunk[];
    items.sort((a, b) => {
        if (a.isEntry && !b.isEntry) {
            return -1;
        }
        if (b.isEntry && !a.isEntry) {
            return 1;
        }
        return 0;
    });
    for (let i = 0, j = 0; i < items.length; ++i) {
        const item = items[i];
        if (item.type === 'chunk') {
            const code = item.code!;
            if (j++ === 0 || !supplementChunks || external) {
                result += code;
                if (item.map) {
                    if (external && outputConfig.sourcemap === 'inline') {
                        result += `\n//# sourceMappingURL=${item.map.toUrl()}\n`;
                    }
                    mappings += item.map;
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
                    entryPoint: item.isEntry,
                    filename: item.fileName
                });
            }
        }
    }
    if (!tempFile && bundle.watchFiles.length) {
        options.outSourceFiles = bundle.watchFiles;
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