import type { ExtendedSettings, ExternalAsset, IDocument, IFileManager, Internal, RequestBody } from '../types/lib';

import path = require('path');
import fs = require('fs-extra');

import Module from '../module';

type DocumentModule = ExtendedSettings.DocumentModule;

type TransformOutput = Internal.Document.TransformOutput;
type TransformResult = Internal.Document.TransformResult;
type SourceMap = Internal.Document.SourceMap;
type SourceMapInput = Internal.Document.SourceMapInput;
type SourceMapOutput = Internal.Document.SourceMapOutput;
type PluginConfig = Internal.Document.PluginConfig;
type Transformer = Internal.Document.Transformer;
type ConfigOrTransformer = Internal.Document.ConfigOrTransformer;

const isString = (value: any): value is string => !!value && typeof value === 'string';

abstract class Document extends Module implements IDocument {
    public static init(this: IFileManager, instance: IDocument, body: RequestBody) {}
    public static async using(this: IFileManager, instance: IDocument, file: ExternalAsset) {}
    public static async finalize(this: IFileManager, instance: IDocument, assets: ExternalAsset[]) {}

    public static createSourceMap(sourcesContent: string, file?: ExternalAsset) {
        return Object.create({
            file,
            sourcesContent,
            output: new Map<string, SourceMapOutput>(),
            "nextMap": function(this: SourceMapInput, name: string, map: SourceMap | string, code: string, includeContent = true) {
                if (typeof map === 'string') {
                    try {
                        map = JSON.parse(map) as SourceMap;
                    }
                    catch {
                        return false;
                    }
                }
                if (typeof map === 'object' && map.mappings) {
                    this.map = map;
                    this.output.set(name, { code, map, sourcesContent: includeContent ? this.sourcesContent : null });
                    return true;
                }
                return false;
            }
        }) as SourceMapInput;
    }

    public readonly internalAssignUUID = '__assign__';

    public abstract moduleName: string;

    private _packageMap: ObjectMap<Transformer> = {};

    constructor(public module: DocumentModule, public templateMap?: Undef<StandardMap>) {
        super();
    }

    findConfig(settings: StandardMap, name: string, type?: string): PluginConfig {
        if (this.module.eval_template && this.templateMap && type) {
            const data = this.templateMap[type] as Undef<StandardMap>;
            if (data) {
                for (const attr in data) {
                    const item = data[attr] as Undef<StandardMap>;
                    if (item && item[name]) {
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
                    const config = this.loadConfig(data, attr + '-output');
                    if (options || config) {
                        return [plugin, options, config];
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
                if (Module.isLocalPath(value = value.trim())) {
                    try {
                        const contents = fs.readFileSync(path.resolve(value), 'utf8').trim();
                        const transformer = this.parseFunction(contents);
                        if (transformer) {
                            if (evaluate) {
                                data[name] = transformer;
                                return transformer;
                            }
                        }
                        else {
                            const result = JSON.parse(contents);
                            if (result && typeof result === 'object') {
                                data[name] = result as StandardMap;
                                return JSON.parse(JSON.stringify(result));
                            }
                        }
                    }
                    catch (err) {
                        this.writeFail(['Could not load config', value], err);
                    }
                }
                else if (path.isAbsolute(value)) {
                    this.writeFail('Only relative paths are supported', new Error(`Unknown config <${name}:${value}>`));
                }
                else if (evaluate) {
                    const transformer = this.parseFunction(value);
                    if (transformer) {
                        data[name] = transformer;
                        return transformer;
                    }
                }
                break;
            }
            case 'object':
                try {
                    return JSON.parse(JSON.stringify(value));
                }
                catch (err) {
                    this.writeFail('Could not load config', err);
                }
                break;
        }
        delete data[name];
    }
    async transform(type: string, code: string, format: string, options: TransformOutput = {}): Promise<Void<TransformResult>> {
        const data = this.module.settings?.[type] as StandardMap;
        if (data) {
            const sourceMap = options.sourceMap;
            const writeFail = this.writeFail.bind(this);
            const errorMessage = (plugin: string, process: string, message: string) => new Error(message + ` <${plugin}:${process}>`);
            let valid: Undef<boolean>;
            for (let process of format.split('+')) {
                const [plugin, baseConfig, outputConfig] = this.findConfig(data, process = process.trim(), type);
                if (plugin) {
                    if (!baseConfig) {
                        this.writeFail('Unable to load configuration', errorMessage(plugin, process, 'Invalid config'));
                    }
                    else {
                        const output: TransformOutput = { ...options, baseConfig, outputConfig, writeFail };
                        const time = Date.now();
                        const next = (result: Undef<string>) => {
                            if (isString(result)) {
                                code = result;
                                valid = true;
                                this.writeTimeElapsed(type, plugin + ': ' + process, time);
                            }
                            else {
                                this.writeFail(['Transform returned empty result', plugin], errorMessage(plugin, process, 'Empty result'));
                            }
                        };
                        this.formatMessage(this.logType.PROCESS, type, ['Transforming source...', plugin], process, { hintColor: 'cyan' });
                        try {
                            let context = require(plugin);
                            try {
                                if (typeof baseConfig === 'function') {
                                    next(await new Promise<Undef<string>>(resolve => baseConfig(context, code, output, resolve)));
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
                                            transformer = context;
                                            context = this;
                                        }
                                        else {
                                            continue;
                                        }
                                    }
                                    next(await transformer(context, code, output));
                                }
                            }
                            catch (err) {
                                this.writeFail(['Unable to transform source', plugin], err);
                            }
                        }
                        catch (err) {
                            this.writeFail([`Install required? <npm i ${plugin}>`, this.moduleName], err);
                        }
                    }
                }
                else {
                    this.writeFail('Process format method not found', errorMessage(this.moduleName, process, 'Unknown plugin'));
                }
            }
            if (valid) {
                let map: Undef<SourceMap>,
                    output: Undef<Map<string, SourceMapOutput>>;
                if (sourceMap) {
                    output = sourceMap.output;
                    if (output && output.size) {
                        map = Array.from(output.values()).pop()!.map;
                    }
                }
                return { code, map, output };
            }
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Document;
    module.exports.default = Document;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Document;