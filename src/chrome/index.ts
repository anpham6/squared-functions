import path = require('path');
import fs = require('fs-extra');

import Module from '../module';

type ExternalAsset = functions.ExternalAsset;
type ExternalCategory = functions.ExternalCategory;

type ChromeModule = functions.settings.ChromeModule;

type TranspileMap = functions.chrome.TranspileMap;

type SourceMapInput = functions.internal.Chrome.SourceMapInput;
type SourceMap = functions.internal.Chrome.SourceMap;
type SourceMapOutput = functions.internal.Chrome.SourceMapOutput;
type PluginConfig = functions.internal.Chrome.PluginConfig;
type ConfigOrTranspiler = functions.internal.Chrome.ConfigOrTranspiler;

const validLocalPath = (value: string) => /^\.?\.[\\/]/.test(value);

const Chrome = new class extends Module implements functions.IChrome {
    public settings: ChromeModule = {};

    private _packageMap: ObjectMap<FunctionType<Undef<string>>> = {};

    findPlugin(settings: Undef<ObjectMap<StandardMap>>, value: string): PluginConfig {
        if (settings) {
            for (const plugin in settings) {
                const data = settings[plugin];
                for (const name in data) {
                    if (name === value) {
                        const options = this.loadOptions(data[name]);
                        const config = this.loadConfig(data[name + '-config']);
                        if (options || config) {
                            return [plugin, options || config, config];
                        }
                    }
                }
            }
        }
        return ([] as unknown) as PluginConfig;
    }
    findTranspiler(settings: Undef<ObjectMap<StandardMap>>, value: string, category: ExternalCategory, transpileMap?: TranspileMap): PluginConfig {
        if (transpileMap && this.settings.eval_text_template) {
            const data = transpileMap[category];
            for (const name in data) {
                const item = data[name][value];
                if (item) {
                    const result = this.loadOptions(item);
                    if (result) {
                        return [name, result, this.loadConfig(data[name][value + '-config'])];
                    }
                    break;
                }
            }
        }
        return this.findPlugin(settings, value);
    }
    loadOptions(value: ConfigOrTranspiler): Undef<ConfigOrTranspiler> {
        if (typeof value === 'string') {
            value = value.trim();
            if (this.settings.eval_function) {
                const transpiler = this.loadTranspiler(value);
                if (transpiler) {
                    return transpiler;
                }
            }
            return this.loadConfig(value);
        }
        else if (typeof value === 'object') {
            try {
                return JSON.parse(JSON.stringify(value));
            }
            catch (err) {
                this.writeFail(`Could not load options [JSON invalid]`, err);
            }
        }
        else {
            return value;
        }
    }
    loadConfig(value: Undef<StandardMap | string>): StandardMap | string {
        if (typeof value ==='string' && validLocalPath(value)) {
            try {
                const content = fs.readFileSync(path.resolve(value), 'utf8').trim();
                if (content) {
                    try {
                        const data = JSON.parse(content) as StandardMap;
                        return data;
                    }
                    catch {
                        return content;
                    }
                }
            }
            catch (err) {
                this.writeFail(`Could not load config [${value}]`, err);
                value = '';
            }
        }
        else if (typeof value === 'object') {
            try {
                return JSON.parse(JSON.stringify(value));
            }
            catch {
                value = '';
            }
        }
        return value || {};
    }
    loadTranspiler(value: string): Null<FunctionType<string>> {
        if (validLocalPath(value)) {
            try {
                value = fs.readFileSync(path.resolve(value), 'utf8').trim();
            }
            catch (err) {
                this.writeFail(`Could not load function [${value}]`, err);
                return null;
            }
        }
        return value.startsWith('function') ? eval(`(${value})`) as FunctionType<string> : null;
    }
    createTransformer(file: ExternalAsset, fileUri: string, sourcesContent: string) {
        return Object.create({
            file,
            fileUri,
            sourcesContent,
            sourceMap: new Map<string, SourceMapOutput>(),
            "nextMap": function(this: SourceMapInput, packageName: string, map: SourceMap | string, value: string, includeContent = true, url?: string) {
                if (typeof map === 'string') {
                    try {
                        map = JSON.parse(map) as SourceMap;
                    }
                    catch {
                        map = {} as SourceMap;
                    }
                }
                if (map && typeof map === 'object' && !map.mappings) {
                    if (this.packageName) {
                        this.sourcesContent = this.sourceMap.get(this.packageName)!.value;
                        this.packageName = '';
                    }
                    return;
                }
                if (!includeContent) {
                    this.sourcesContent = null;
                }
                if (this.packageName) {
                    this.sourceMap.delete(this.packageName);
                }
                this.map = map;
                this.packageName = packageName;
                this.sourceMap.set(packageName, { value, map, url, sourcesContent: this.sourcesContent });
            }
        }) as SourceMapInput;
    }
    async transform(type: ExternalCategory, format: string, value: string, input: SourceMapInput, transpileMap?: TranspileMap): Promise<Void<[string, Map<string, SourceMapOutput>]>> {
        const data = this.settings[type];
        if (data) {
            let valid: Undef<boolean>;
            const formatters = format.split('+');
            for (let i = 0, length = formatters.length; i < length; ++i) {
                const [name, custom, config] = this.findTranspiler(data, formatters[i].trim(), type, transpileMap);
                if (name) {
                    try {
                        if (typeof custom === 'function') {
                            const result = custom(require(name), value, typeof config === 'object' ? config : config, input);
                            if (result && typeof result === 'string') {
                                if (i === length - 1) {
                                    return [result, input.sourceMap];
                                }
                                value = result;
                                valid = true;
                            }
                        }
                        else {
                            this._packageMap[name] ||= require(`./packages/${name}`).default;
                            const result: Undef<string> = await this._packageMap[name](
                                value,
                                typeof custom === 'object' ? custom : !custom && typeof config === 'object' ? config : custom || {},
                                typeof config === 'object' ? config : config,
                                input
                            );
                            if (result) {
                                if (i === length - 1) {
                                    return [result, input.sourceMap];
                                }
                                value = result;
                                valid = true;
                            }
                        }
                    }
                    catch (err) {
                        this.writeFail(`Install required? [npm i ${name}]`, err);
                    }
                }
            }
            if (valid) {
                return [value, input.sourceMap];
            }
        }
    }
    formatContent(mimeType: string, format: string, value: string, input: SourceMapInput, transpileMap?: TranspileMap) {
        if (mimeType.endsWith('text/html')) {
            return this.transform('html', format, value, input, transpileMap);
        }
        else if (mimeType.endsWith('text/css')) {
            return this.transform('css', format, value, input, transpileMap);
        }
        else if (mimeType.endsWith('text/javascript')) {
            return this.transform('js', format, value, input, transpileMap);
        }
        return Promise.resolve();
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Chrome;
    module.exports.default = Chrome;
    module.exports.__esModule = true;
}

export default Chrome;