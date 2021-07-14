import type { DataSource, ElementAction, ViewEngine, XmlTagNode } from '../types/lib/squared';

import type { IDocument, IFileManager } from '../types/lib';
import type { ExternalAsset } from '../types/lib/asset';
import type { ChunkData, ConfigOrTransformer, PluginConfig, SourceInput, SourceMap, SourceMapInput, SourceMapOptions, SourceMapOutput, TransformCallback, TransformOptions, TransformOutput, TransformResult, Transformer } from '../types/lib/document';
import type { DocumentModule } from '../types/lib/module';
import type { RequestBody } from '../types/lib/node';

import path = require('path');
import fs = require('fs');

import Module from '../module';

const REGEXP_SOURCEMAPPINGURL = /\n*(\/\*)?\s*(\/\/)?[#@] sourceMappingURL=(['"])?([^\s'"]*)\3\s*?(\*\/)?\n?/;
const CONFIG_CACHE: WeakMap<StandardMap, StandardMap> = new WeakMap();

function createSourceMap(value: string) {
    return Object.create({
        code: value,
        output: new Map<string, SourceMapOutput>(),
        "reset": function(this: SourceMapInput) {
            delete this.map;
            delete this.sourceMappingURL;
            this.output.clear();
        },
        "nextMap": function(this: SourceMapInput, name: string, code: string, map: SourceMap | string, sourceMappingURL = '', emptySources?: boolean) {
            if (Module.isString(map)) {
                try {
                    map = JSON.parse(map) as SourceMap;
                }
                catch {
                    return false;
                }
            }
            if (Module.isObject<SourceMap>(map) && Module.isString(map.mappings)) {
                if (emptySources) {
                    map.sources = [""];
                }
                this.code = code;
                this.map = map;
                if (sourceMappingURL) {
                    this.sourceMappingURL = sourceMappingURL;
                }
                let mapName = name,
                    i = 0;
                while (this.output.has(mapName)) {
                    mapName = name + '_' + ++i;
                }
                this.output.set(mapName, { code, map, sourceMappingURL });
                return true;
            }
            return false;
        }
    }) as SourceMapInput;
}

function convertOptions(options: StandardMap) {
    for (const attr in options) {
        const value = options[attr];
        if (typeof value === 'string') {
            const method = Module.asFunction(value);
            if (method) {
                options[attr] = method;
            }
        }
    }
    return options;
}

const errorMessage = (hint: string, process: string, message: string) => new Error((hint ? hint + ': ' : '') + process + ` (${message})`);
const getSourceMappingURL = (value: string) => `\n//# sourceMappingURL=${value}\n`;

abstract class Document extends Module implements IDocument {
    static async using(this: IFileManager, instance: IDocument, file: ExternalAsset) {}
    static async cleanup(this: IFileManager, instance: IDocument) {}

    static async finalize(this: IFileManager, instance: IDocument) {
        const extensions = instance.module.extensions;
        if (extensions) {
            for (const ext of extensions) {
                try {
                    await (require(ext) as TransformCallback).call(this, instance, __dirname);
                }
                catch (err) {
                    instance.writeFail([`Unable to load <${this.moduleName || 'unknown'}> extension`, ext], err);
                }
            }
        }
    }

    static createSourceMap(code: string) {
        return createSourceMap(code);
    }

    static writeSourceMap(localUri: string, sourceMap: SourceMapOutput, options?: SourceMapOptions) {
        const map = sourceMap.map;
        if (!map) {
            return;
        }
        let file: Undef<string>,
            sourceRoot: Undef<string>,
            sourceMappingURL: Undef<string>,
            emptySources: Undef<boolean>;
        if (options) {
            ({ file, sourceRoot, sourceMappingURL, emptySources } = options);
        }
        file ||= path.basename(localUri);
        if (!sourceMappingURL) {
            sourceMappingURL = sourceMap.sourceMappingURL || file;
        }
        if (!sourceMappingURL.endsWith('.map')) {
            sourceMappingURL += '.map';
        }
        let uri = '',
            code = sourceMap.code,
            found: Undef<boolean>,
            inlineMap: Undef<boolean>;
        code = code.replace(REGEXP_SOURCEMAPPINGURL, (...capture) => {
            found = true;
            inlineMap = capture[4].startsWith('data:application/json');
            return !inlineMap && (capture[2] && !capture[1] && !capture[5] || capture[1] && capture[5]) ? getSourceMappingURL(sourceMappingURL!) : capture[0];
        });
        map.file = file;
        if (sourceRoot) {
            map.sourceRoot = sourceRoot;
        }
        if (emptySources) {
            map.sources = [""];
        }
        if (!inlineMap) {
            if (!found) {
                code += getSourceMappingURL(sourceMappingURL);
            }
            try {
                uri = path.join(path.dirname(localUri), sourceMappingURL);
                fs.writeFileSync(uri, JSON.stringify(map), 'utf8');
            }
            catch (err) {
                this.writeFail(['Unable to write file', uri], err, this.LOG_TYPE.FILE);
                return '';
            }
        }
        if (uri) {
            sourceMap.code = code;
        }
        return uri;
    }

    static removeSourceMappingURL(value: string): [string, string?] {
        const match = REGEXP_SOURCEMAPPINGURL.exec(value);
        return match ? [value.substring(0, match.index) + value.substring(match.index + match[0].length), match[4]] : [value];
    }

    static createSourceFilesMethod(this: IFileManager, instance: IDocument, file: ExternalAsset, source?: string) {
        return () => {
            const imports = instance.imports;
            const { localUri, uri } = file;
            let sourceFile: Undef<[string, string?][]>,
                sourcesRelativeTo: Undef<string>;
            if (Document.isFileUNC(uri!) || path.isAbsolute(uri!)) {
                sourceFile = [[uri!]];
            }
            else if (imports && Object.keys(imports).length) {
                sourceFile = [];
                const bundleId = file.bundleId;
                const assets = bundleId ? instance.assets.filter(item => item.bundleId === bundleId) : [file];
                const contentToAppend = this.contentToAppend.get(localUri!);
                assets.sort((a, b) => a.bundleIndex! - b.bundleIndex!);
                for (let i = 0, length = assets.length; i < length; ++i) {
                    const item = assets[i];
                    const value = item.uri!;
                    let localFile: Undef<string>;
                    if (!item.trailingContent) {
                        for (const attr in imports) {
                            if (value === attr) {
                                localFile = imports[attr]!;
                                break;
                            }
                        }
                        if (!localFile) {
                            for (let attr in imports) {
                                if (attr[attr.length - 1] !== '/') {
                                    attr += '/';
                                }
                                if (value.startsWith(attr)) {
                                    localFile = path.resolve(path.join(imports[attr]!, value.substring(attr.length)));
                                    break;
                                }
                            }
                        }
                    }
                    try {
                        if (localFile && fs.existsSync(localFile)) {
                            sourceFile.push([localFile]);
                        }
                        else {
                            const index = item.bundleIndex!;
                            if (index === 0) {
                                if (!source || length === 1) {
                                    sourceFile = undefined;
                                    break;
                                }
                                sourceFile.push(['', source]);
                            }
                            else if (contentToAppend && contentToAppend[index - 1]) {
                                sourceFile.push(['', contentToAppend[index - 1]]);
                            }
                            else {
                                sourceFile = undefined;
                                break;
                            }
                        }
                    }
                    catch (err) {
                        instance.writeFail(['Unable to check file', localFile!], err, this.logType.FILE);
                        sourceFile = undefined;
                        break;
                    }
                }
            }
            if (sourceFile && sourceFile[0][0]) {
                sourcesRelativeTo = path.dirname(sourceFile[0][0]);
            }
            return { sourceFile, sourcesRelativeTo } as SourceInput;
        };
    }

    assets: ExternalAsset[] = [];
    host?: IFileManager;
    imports?: StringMap;
    configData?: StandardMap;

    private _packageMap: ObjectMap<Transformer> = {};
    private _xmlNodes: Null<XmlTagNode[]> = null;
    private _dataSource: Null<DataSource[]> = null;

    constructor(public module: DocumentModule) {
        super();
    }

    init(assets: ExternalAsset[], body: RequestBody) {
        this.imports = body.imports ? { ...this.module.imports, ...body.imports } : this.module.imports;
    }

    findConfig(settings: StandardMap, name: string, type?: string): PluginConfig {
        if (type && this.configData && this.module.eval_template) {
            const data = this.configData[type] as Undef<StandardMap>;
            if (data) {
                for (const attr in data) {
                    const item = data[attr];
                    if (Document.isObject(item) && item[name]) {
                        const options = this.loadConfig(item, name);
                        if (options) {
                            return [attr, options, this.loadConfig(item, name + '-output')];
                        }
                        break;
                    }
                }
            }
        }
        for (const plugin in settings) {
            const data = settings[plugin];
            for (const attr in data) {
                if (attr === name) {
                    const options = this.loadConfig(data, attr);
                    const output = this.loadConfig(data, attr + '-output');
                    if (options || output) {
                        return [plugin, options, output];
                    }
                }
            }
        }
        return [];
    }
    loadConfig(data: StandardMap, name: string): Undef<ConfigOrTransformer> {
        let value: Undef<StandardMap | string | Transformer> = data[name];
        switch (typeof value) {
            case 'function':
                return value;
            case 'string': {
                const evaluate = this.module.eval_function && !name.endsWith('-output');
                const uri = Module.fromLocalPath(value = value.trim());
                if (uri) {
                    try {
                        const contents = fs.readFileSync(uri, 'utf8').trim();
                        if (contents) {
                            const transformer = Module.parseFunction(contents);
                            if (transformer) {
                                if (evaluate) {
                                    return data[name] = transformer;
                                }
                            }
                            else {
                                let result = JSON.parse(contents) as Null<StandardMap>;
                                if (Module.isObject(result)) {
                                    data[name] = result;
                                    CONFIG_CACHE.set(data[name], result = convertOptions(JSON.parse(JSON.stringify(result))));
                                    return result;
                                }
                            }
                        }
                    }
                    catch (err) {
                        this.writeFail(['Unable to read file', uri], err, this.logType.FILE);
                    }
                }
                else if (path.isAbsolute(value)) {
                    this.writeFail('Absolute path not supported', errorMessage(name, value, 'Unsupported access'));
                }
                else if (evaluate) {
                    const transformer = Module.parseFunction(value);
                    if (transformer) {
                        return data[name] = transformer;
                    }
                }
                break;
            }
            case 'object':
                try {
                    let result = CONFIG_CACHE.get(value);
                    if (result) {
                        return { ...result };
                    }
                    CONFIG_CACHE.set(value, result = convertOptions(JSON.parse(JSON.stringify(value))));
                    return result;
                }
                catch (err) {
                    this.writeFail('Could not load config', err);
                }
                break;
        }
        delete data[name];
    }
    async parseTemplate(viewEngine: ViewEngine | string, template: string, data: PlainObject[]) {
        if (Module.isString(viewEngine)) {
            const view = (this.module.settings?.view_engine as Undef<StandardMap>)?.[viewEngine] as Undef<ViewEngine>;
            if (!view) {
                this.writeFail(['Setting not found', viewEngine], errorMessage('view engine', viewEngine, 'Unknown'));
                return null;
            }
            viewEngine = view;
        }
        try {
            const length = data.length;
            if (length) {
                const { name, singleRow, options = {} } = viewEngine;
                const context = require(name);
                const render = await context.compile(template, options.compile) as FunctionType<Promise<string> | string>;
                const output = options.output;
                let result = '';
                for (let i = 0; i < length; ++i) {
                    let row = data[i];
                    row['__index__'] ??= i + 1;
                    if (Module.isObject(output)) {
                        row = { ...output, ...row };
                    }
                    if (!singleRow) {
                        result += await render.call(context, row);
                    }
                }
                return singleRow ? render.call(context, data) : result;
            }
            return '';
        }
        catch (err) {
            this.writeFail(['View engine incompatible', viewEngine.name], err);
        }
        return null;
    }
    async transform(type: string, code: string, format: string, options: TransformOutput = {}): Promise<Void<TransformResult>> {
        const data = (this.module.settings as Undef<StandardMap>)?.transform?.[type] as Undef<StandardMap>;
        if (data) {
            const sourceMap = options.sourceMap ||= Document.createSourceMap(code);
            const writeFail = this.writeFail.bind(this);
            const supplementChunks: Undef<ChunkData[]> = options.chunks ? [] : undefined;
            let valid: Undef<boolean>,
                sourceFiles: Undef<string[]>;
            for (let process of format.split('+')) {
                const [plugin, baseConfig, outputConfig = {}] = this.findConfig(data, process = process.trim(), type);
                if (plugin) {
                    if (!baseConfig) {
                        this.writeFail('Unable to load configuration', errorMessage(plugin, process, 'Invalid config'));
                    }
                    else {
                        const output = { ...options, outputConfig, supplementChunks, createSourceMap, writeFail } as TransformOptions;
                        const time = Date.now();
                        const next = (result: Undef<string>) => {
                            let failed: Undef<boolean>;
                            if (Module.isString(result)) {
                                code = result;
                                valid = true;
                            }
                            else {
                                failed = true;
                                this.writeFail(['Transform had empty result', plugin], errorMessage(plugin, process, 'Empty'));
                            }
                            this.writeTimeProcess(failed ? 'CHECK' : type, plugin + ': ' + process, time, { failed });
                        };
                        this.formatMessage(this.logType.PROCESS, type, ['Transforming source...', plugin], process, { hintColor: 'cyan' });
                        try {
                            let context = require(plugin);
                            try {
                                if (typeof baseConfig === 'function') {
                                    output.baseConfig = outputConfig;
                                    next(baseConfig.toString().startsWith('async') ? await baseConfig(context, code, output) : await new Promise<Undef<string>>(resolve => baseConfig(context, code, output, resolve)));
                                }
                                else {
                                    let transformer = this._packageMap[plugin];
                                    if (!transformer) {
                                        const filepath = path.join(__dirname, 'packages', plugin + '.js');
                                        if (fs.existsSync(filepath)) {
                                            transformer = require(filepath);
                                            this._packageMap[plugin] = transformer;
                                        }
                                        else if (typeof context === 'function' && context.name === 'transform') {
                                            transformer = context as Transformer;
                                            context = this;
                                        }
                                        else {
                                            this.writeFail(['Transformer not compatible', plugin], errorMessage(plugin, process, 'Invalid function'));
                                            continue;
                                        }
                                    }
                                    output.baseConfig = baseConfig;
                                    next(await transformer!(context, code, output));
                                }
                                if (output.outSourceFiles) {
                                    if (!sourceFiles) {
                                        sourceFiles = output.outSourceFiles;
                                    }
                                    else {
                                        output.outSourceFiles.forEach(value => sourceFiles!.includes(value) && sourceFiles!.push(value));
                                    }
                                }
                            }
                            catch (err) {
                                this.writeFail(['Unable to transform source', plugin], err);
                            }
                        }
                        catch (err) {
                            this.writeFail([`Install required? <${this.moduleName}>`, 'npm i ' + plugin], err);
                        }
                    }
                }
                else {
                    this.writeFail('Format method not found', errorMessage('', process, 'Unknown plugin'));
                }
            }
            if (valid) {
                const map = sourceMap.map && sourceMap.code === code ? sourceMap.map : undefined;
                return {
                    code,
                    map,
                    chunks: supplementChunks && supplementChunks.length ? supplementChunks.map(item => ({ code: item.code, map: map && item.sourceMap && item.sourceMap.map, entryPoint: item.entryPoint, filename: item.filename })) : undefined,
                    sourceFiles
                };
            }
        }
    }
    get xmlNodes() {
        if (!this._xmlNodes) {
            const nodes: XmlTagNode[] = [];
            (this.assets as ElementAction[]).forEach(item => item.element && nodes.push(item.element));
            (this.dataSource as ElementAction[]).forEach(item => item.element && nodes.push(item.element));
            this._xmlNodes = nodes;
        }
        return this._xmlNodes;
    }
    get dataSource() {
        return this._dataSource ||= this.host?.getDataSourceItems(this) || [];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Document;
    module.exports.default = Document;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Document;