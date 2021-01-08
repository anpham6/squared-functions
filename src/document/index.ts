import type { ExtendedSettings, ExternalAsset, IDocument, IFileManager, RequestBody, internal } from '../types/lib';

import path = require('path');
import fs = require('fs-extra');

import Module from '../module';

type DocumentModule = ExtendedSettings.DocumentModule;

type SourceMapInput = internal.Document.SourceMapInput;
type SourceMapOutput = internal.Document.SourceMapOutput;
type PluginConfig = internal.Document.PluginConfig;
type Transformer = internal.Document.Transformer;
type ConfigOrTransformer = internal.Document.ConfigOrTransformer;

abstract class Document extends Module implements IDocument {
    public static init(this: IFileManager, document: IDocument) {}
    public static async using(this: IFileManager, document: IDocument, file: ExternalAsset) {}
    public static async finalize(this: IFileManager, document: IDocument, assets: ExternalAsset[]) {}

    public serverRoot = '__serverroot__';
    public documentName = '';
    public templateMap?: StandardMap;

    private _packageMap: ObjectMap<Transformer> = {};

    constructor(body: RequestBody, public settings: DocumentModule = {}) {
        super();
        this.templateMap = body.templateMap;
    }

    findPluginData(type: string, value: string, settings: ObjectMap<StandardMap>): PluginConfig {
        if (this.templateMap && this.settings.eval_template) {
            const data = this.templateMap[type];
            for (const plugin in data) {
                const item = data[plugin][value];
                if (item) {
                    const options = this.loadOptions(item);
                    if (options) {
                        return [plugin, options, this.loadConfig(data[plugin][value + '-output'])];
                    }
                    break;
                }
            }
        }
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
        return [];
    }
    loadOptions(value: ConfigOrTransformer | string): Undef<ConfigOrTransformer> {
        if (typeof value === 'string' && this.settings.eval_function) {
            const transformer = this.parseFunction(value);
            if (transformer) {
                return transformer;
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
    async transform(type: string, format: string, value: string, input?: SourceMapInput): Promise<Void<[string, Undef<Map<string, SourceMapOutput>>]>> {
        const settings = this.settings[type];
        if (settings) {
            const writeFail = this.writeFail.bind(this);
            let valid: Undef<boolean>;
            for (let name of format.split('+')) {
                const [plugin, options, output] = this.findPluginData(type, name = name.trim(), settings);
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
                                let transformer = this._packageMap[plugin];
                                if (!transformer) {
                                    const filepath = path.join(__dirname, 'packages', plugin + '.js');
                                    transformer = require(fs.existsSync(filepath) ? filepath : plugin);
                                }
                                const result = await transformer.call(this, value, options, output, input, writeFail);
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
                return [value, input && input.sourceMap];
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