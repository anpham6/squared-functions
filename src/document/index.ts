import type { ViewEngine } from '../types/lib/squared';

import type { IDocument, IFileManager } from '../types/lib';
import type { ExternalAsset } from '../types/lib/asset';
import type { ConfigOrTransformer, PluginConfig, SourceMap, SourceMapInput, SourceMapOptions, SourceMapOutput, TransformCallback, TransformOptions, TransformOutput, TransformResult, Transformer } from '../types/lib/document';
import type { DocumentModule } from '../types/lib/module';
import type { RequestBody } from '../types/lib/node';

import path = require('path');
import fs = require('fs');

import Module from '../module';

const REGEXP_SOURCEMAPPINGURL = /\n*(\/\*)?\s*(\/\/)?[#@] sourceMappingURL=(['"])?([^\s'"]*)\3\s*?(\*\/)?\n?/;

const errorMessage = (hint: string, process: string, message: string) => new Error((hint ? hint + ' -> ' : '') + process + ` (${message})`);
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
                    this.writeFail([`Unable to load <${this.moduleName || 'unknown'}> extension`, ext], err);
                }
            }
        }
    }

    static createSourceMap(value: string) {
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

    static writeSourceMap(localUri: string, sourceMap: SourceMapOutput, options?: SourceMapOptions) {
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

    public configData?: Undef<StandardMap>;

    abstract moduleName: string;
    abstract assets: ExternalAsset[];

    private _packageMap: ObjectMap<Transformer> = {};

    constructor(public module: DocumentModule) {
        super();
    }

    abstract init(assets: ExternalAsset[], body: RequestBody): void;

    findConfig(settings: StandardMap, name: string, type?: string): PluginConfig {
        if (type && this.module.eval_template && this.configData) {
            const data = this.configData[type] as Undef<StandardMap>;
            if (data) {
                for (const attr in data) {
                    const item = data[attr] as Undef<StandardMap>;
                    if (item?.[name]) {
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
                        if (contents) {
                            const transformer = Module.parseFunction(contents);
                            if (transformer) {
                                if (evaluate) {
                                    return data[name] = transformer;
                                }
                            }
                            else {
                                const result = JSON.parse(contents) as Null<StandardMap>;
                                if (Module.isObject(result)) {
                                    return JSON.parse(JSON.stringify(data[name] = result));
                                }
                            }
                        }
                    }
                    catch (err) {
                        this.writeFail(['Unable to read file', uri], err, this.logType.FILE);
                    }
                }
                else if (path.isAbsolute(value)) {
                    this.writeFail('Only relative paths are supported', errorMessage(name, value, '(Unknown config)'));
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
                    return JSON.parse(JSON.stringify(value));
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
                this.writeFail(['Setting not found', viewEngine], errorMessage('View engine', viewEngine, '(Unknown)'));
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
            let valid: Undef<boolean>;
            for (let process of format.split('+')) {
                const [plugin, baseConfig, outputConfig = {}] = this.findConfig(data, process = process.trim(), type);
                if (plugin) {
                    if (!baseConfig) {
                        this.writeFail('Unable to load configuration', errorMessage(plugin, process, 'Invalid config'));
                    }
                    else {
                        const output = { ...options, outputConfig, writeFail } as TransformOptions;
                        const time = Date.now();
                        const next = (result: Undef<string>) => {
                            if (Module.isString(result)) {
                                code = result;
                                valid = true;
                                this.writeTimeProcess(type, plugin + ': ' + process, time);
                            }
                            else {
                                this.writeFail(['Transform returned empty result', plugin], errorMessage(plugin, process, 'Empty'));
                            }
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