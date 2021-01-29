import type { IDocument, IFileManager } from '../types/lib';
import type { ExternalAsset } from '../types/lib/asset';
import type { ConfigOrTransformer, PluginConfig, SourceMap, SourceMapInput, SourceMapOptions, SourceMapOutput, TransformOptions, TransformOutput, TransformResult, Transformer } from '../types/lib/document';
import type { DocumentModule } from '../types/lib/module';
import type { RequestBody } from '../types/lib/node';

import path = require('path');
import fs = require('fs-extra');

import Module from '../module';

const isString = (value: any): value is string => !!value && typeof value === 'string';
const getSourceMappingURL = (value: string) => `\n//# sourceMappingURL=${value}\n`;

abstract class Document extends Module implements IDocument {
    public static async using(this: IFileManager, instance: IDocument, file: ExternalAsset) {}
    public static async finalize(this: IFileManager, instance: IDocument, assets: ExternalAsset[]) {}

    public static createSourceMap(value: string) {
        return Object.create({
            code: value,
            output: new Map<string, SourceMapOutput>(),
            "reset": function(this: SourceMapInput) {
                delete this.map;
                delete this.sourceMappingURL;
                this.output.clear();
            },
            "nextMap": function(this: SourceMapInput, name: string, code: string, map: SourceMap | string, sourceMappingURL = '') {
                if (typeof map === 'string') {
                    try {
                        map = JSON.parse(map) as SourceMap;
                    }
                    catch {
                        return false;
                    }
                }
                if (typeof map === 'object' && map.mappings) {
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

    public static writeSourceMap(localUri: string, sourceMap: SourceMapOutput, options?: SourceMapOptions) {
        const map = sourceMap.map;
        if (!map) {
            return;
        }
        let file: Undef<string>,
            sourceRoot: Undef<string>,
            sourceMappingURL: Undef<string>;
        if (options) {
            ({ file, sourceRoot, sourceMappingURL } = options);
        }
        file ||= path.basename(localUri);
        if (!sourceMappingURL) {
            sourceMappingURL = sourceMap.sourceMappingURL || file;
        }
        if (!sourceMappingURL.endsWith('.map')) {
            sourceMappingURL += '.map';
        }
        let uri: Undef<string>,
            code = sourceMap.code,
            found = false,
            inlineMap = false;
        code = code.replace(/\n*(\/\*)?\s*(\/\/)?[#@] sourceMappingURL=(['"])?([^\s'"]*)\3\s*?(\*\/)?\n?/, (...capture) => {
            found = true;
            inlineMap = capture[4].startsWith('data:application/json');
            return !inlineMap && (capture[2] && !capture[1] && !capture[5] || capture[1] && capture[5]) ? getSourceMappingURL(sourceMappingURL!) : capture[0];
        });
        map.file = file;
        if (sourceRoot) {
            map.sourceRoot = sourceRoot;
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
                this.writeFail('Unable to write source map', err);
            }
        }
        if (uri) {
            sourceMap.code = code;
        }
        return uri;
    }

    public readonly internalAssignUUID = '__assign__';

    public abstract moduleName: string;

    private _packageMap: ObjectMap<Transformer> = {};

    constructor(public module: DocumentModule, public templateMap?: Undef<StandardMap>) {
        super();
    }

    public abstract init(assets: ExternalAsset[], body: RequestBody): void;

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
                const uri = Module.fromLocalPath(value = value.trim());
                if (uri) {
                    try {
                        const contents = fs.readFileSync(uri, 'utf8').trim();
                        const transformer = Module.parseFunction(contents);
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
                    const transformer = Module.parseFunction(value);
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
            const sourceMap = options.sourceMap ||= Document.createSourceMap(code);
            const writeFail = this.writeFail.bind(this);
            const errorMessage = (plugin: string, process: string, message: string) => new Error(message + ` <${plugin}:${process}>`);
            let valid: Undef<boolean>;
            for (let process of format.split('+')) {
                const [plugin, baseConfig, outputConfig = {}] = this.findConfig(data, process = process.trim(), type);
                if (plugin) {
                    if (!baseConfig) {
                        this.writeFail('Unable to load configuration', errorMessage(plugin, process, 'Invalid config'));
                    }
                    else {
                        const output = { ...options, sourceMap, outputConfig, writeFail } as TransformOptions;
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
                                    output.baseConfig = outputConfig;
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
                                            this.writeFail(['Transformer was not executed', plugin], errorMessage(plugin, process, 'Invalid function'));
                                            continue;
                                        }
                                    }
                                    output.baseConfig = baseConfig;
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
                return { code, map: sourceMap.code === code ? sourceMap.map : undefined };
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