import path = require('path');
import fs = require('fs-extra');

import Module from '../module';

type ExternalAsset = functions.ExternalAsset;
type ExternalCategory = functions.ExternalCategory;
type RequestBody = functions.RequestBody;

type ChromeModule = functions.settings.ChromeModule;
type TranspileMap = functions.chrome.TranspileMap;

type SourceMap = functions.internal.Chrome.SourceMap;
type SourceMapInput = functions.internal.Chrome.SourceMapInput;
type SourceMapOutput = functions.internal.Chrome.SourceMapOutput;
type PluginConfig = functions.internal.Chrome.PluginConfig;
type ConfigOrTranspiler = functions.internal.Chrome.ConfigOrTranspiler;

const validLocalPath = (value: string) => /^\.?\.[\\/]/.test(value);

const Chrome = class extends Module implements functions.IChrome {
    public unusedStyles?: string[];
    public transpileMap?: TranspileMap;

    constructor (public settings: ChromeModule = {}, body: RequestBody) {
        super();
        this.unusedStyles = body.unusedStyles;
        this.transpileMap = body.transpileMap;
    }

    private _packageMap: ObjectMap<FunctionType<Undef<string>>> = {};

    findPlugin(settings: Undef<ObjectMap<StandardMap>>, value: string): PluginConfig {
        if (settings) {
            for (const plugin in settings) {
                const data = settings[plugin];
                for (const name in data) {
                    if (name === value) {
                        const options = this.loadOptions(data[name]);
                        const config = this.loadConfig(data[name + '-output']);
                        if (options || config) {
                            return [plugin, options, config];
                        }
                    }
                }
            }
        }
        return [];
    }
    findTranspiler(settings: Undef<ObjectMap<StandardMap>>, value: string, category: ExternalCategory): PluginConfig {
        if (this.transpileMap && this.settings.eval_text_template) {
            const data = this.transpileMap[category];
            for (const name in data) {
                const item = data[name][value];
                if (item) {
                    const result = this.loadOptions(item);
                    if (result) {
                        return [name, result, this.loadConfig(data[name][value + '-output'])];
                    }
                    break;
                }
            }
        }
        return this.findPlugin(settings, value);
    }
    loadOptions(value: ConfigOrTranspiler | string): Undef<ConfigOrTranspiler> {
        if (typeof value === 'string') {
            if (this.settings.eval_function) {
                const transpiler = this.loadTranspiler(value);
                if (transpiler) {
                    return transpiler;
                }
            }
        }
        return this.loadConfig(value);
    }
    loadConfig(value: Undef<StandardMap | string>): Undef<StandardMap> {
        if (typeof value ==='string') {
            value = value.trim();
            if (validLocalPath(value)) {
                try {
                    return JSON.parse(fs.readFileSync(path.resolve(value), 'utf8').trim()) as StandardMap;
                }
                catch (err) {
                    this.writeFail(['Could not load config', value], err);
                }
            }
            else {
                this.writeFail('Only relateive paths are supported', value);
            }
        }
        else if (typeof value === 'object') {
            try {
                return JSON.parse(JSON.stringify(value));
            }
            catch (err) {
                this.writeFail(['Could not parse config', 'JSON invalid'], err);
            }
        }
    }
    loadTranspiler(value: string): Null<FunctionType<string>> {
        value = value.trim();
        if (validLocalPath(value)) {
            try {
                value = fs.readFileSync(path.resolve(value), 'utf8').trim();
            }
            catch (err) {
                this.writeFail(['Could not load function', value], err);
                return null;
            }
        }
        return value.startsWith('function') ? eval(`(${value})`) as FunctionType<string> : null;
    }
    createSourceMap(file: ExternalAsset, fileUri: string, sourcesContent: string) {
        return Object.create({
            file,
            fileUri,
            sourcesContent,
            sourceMap: new Map<string, SourceMapOutput>(),
            "nextMap": function(this: SourceMapInput, name: string, map: SourceMap | string, value: string, includeContent = true) {
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
                    this.sourceMap.set(name, { value, map, sourcesContent: includeContent ? this.sourcesContent : null });
                    return true;
                }
                return false;
            }
        }) as SourceMapInput;
    }
    async transform(type: ExternalCategory, format: string, value: string, input: SourceMapInput): Promise<Void<[string, Map<string, SourceMapOutput>]>> {
        const data = this.settings[type];
        if (data) {
            let valid: Undef<boolean>;
            const formatters = format.split('+');
            for (let i = 0, length = formatters.length; i < length; ++i) {
                const name = formatters[i].trim();
                const [plugin, options, output] = this.findTranspiler(data, name, type);
                if (plugin) {
                    if (!options) {
                        this.writeFail('Unable to load configuration', plugin);
                    }
                    else if (typeof options === 'function') {
                        try {
                            const result = options(require(plugin), value, output, input);
                            if (result && typeof result === 'string') {
                                value = result;
                                valid = true;
                            }
                        }
                        catch (err) {
                            this.writeFail(['Install required?', `npm i ${plugin}`], err);
                        }
                    }
                    else {
                        try {
                            this._packageMap[plugin] ||= require(`./packages/${plugin}`).default;
                            const result: Undef<string> = await this._packageMap[plugin](value, options, output, input );
                            if (result) {
                                value = result;
                                valid = true;
                            }
                        }
                        catch (err) {
                            this.writeFail(['Transformer', plugin], err);
                        }
                    }
                }
                else {
                    this.writeFail('Process method not found', name);
                }
            }
            if (valid) {
                return [value, input.sourceMap];
            }
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Chrome;
    module.exports.default = Chrome;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Chrome;