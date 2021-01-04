import type { TranspileMap } from '../types/lib/chrome';

import path = require('path');
import fs = require('fs-extra');

import Module from '../module';

type ExternalCategory = functions.ExternalCategory;
type RequestBody = functions.RequestBody;

type ChromeModule = functions.ExtendedSettings.ChromeModule;

type SourceMapInput = functions.internal.Chrome.SourceMapInput;
type SourceMapOutput = functions.internal.Chrome.SourceMapOutput;
type PluginConfig = functions.internal.Chrome.PluginConfig;
type ConfigOrTranspiler = functions.internal.Chrome.ConfigOrTranspiler;

type Transpiler = FunctionType<Undef<string>>;

class Chrome extends Module implements functions.IChrome {
    public serverRoot = '__serverroot__';
    public unusedStyles?: string[];
    public transpileMap?: TranspileMap;

    private _packageMap: ObjectMap<Transpiler> = {};

    constructor (body: RequestBody, public settings: ChromeModule = {}, public productionRelease = false) {
        super();
        this.unusedStyles = body.unusedStyles;
        this.transpileMap = body.transpileMap;
    }

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
        if (typeof value === 'string' && this.settings.eval_function) {
            const transpiler = this.parseFunction(value);
            if (transpiler) {
                return transpiler;
            }
        }
        return this.loadConfig(value);
    }
    loadConfig(value: Undef<StandardMap | string>): Undef<StandardMap> {
        if (typeof value ==='string') {
            if (Module.isLocalPath(value = value.trim())) {
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
    async transform(type: ExternalCategory, format: string, value: string, input: SourceMapInput): Promise<Void<[string, Map<string, SourceMapOutput>]>> {
        const data = this.settings[type];
        if (data) {
            let valid: Undef<boolean>;
            const formatters = format.split('+');
            const writeFail = this.writeFail.bind(this);
            for (let i = 0, length = formatters.length; i < length; ++i) {
                const name = formatters[i].trim();
                const [plugin, options, output] = this.findTranspiler(data, name, type);
                if (plugin) {
                    if (!options) {
                        this.writeFail('Unable to load configuration', plugin);
                    }
                    else {
                        this.formatMessage(this.logType.PROCESS, type, ['Transforming source...', plugin], name, { hintColor: 'cyan' });
                        const time = Date.now();
                        const success = () => this.writeTimeElapsed(type, plugin + ': ' + name, time);
                        if (typeof options === 'function') {
                            try {
                                const result = options(require(plugin), value, output, input, writeFail);
                                if (result && typeof result === 'string') {
                                    value = result;
                                    valid = true;
                                    success();
                                }
                            }
                            catch (err) {
                                this.writeFail(['Install required?', 'npm i ' + plugin], err);
                            }
                        }
                        else {
                            try {
                                let transformer: Undef<Transpiler> = this._packageMap[plugin];
                                if (!transformer) {
                                    const filepath = path.join(__dirname, '/packages/' + plugin + '.js');
                                    transformer = require(fs.existsSync(filepath) ? filepath : plugin);
                                }
                                const result: Undef<string> = await transformer!.call(this, value, options, output, input, writeFail);
                                if (result) {
                                    value = result;
                                    valid = true;
                                    success();
                                }
                            }
                            catch (err) {
                                this.writeFail(['Unable to transform source', plugin], err);
                            }
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
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Chrome;
    module.exports.default = Chrome;
    Object.defineProperty(module.exports, '__esModule', { value: true });
}

export default Chrome;