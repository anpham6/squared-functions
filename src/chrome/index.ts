import path = require('path');
import fs = require('fs-extra');

import Module from '../module';

type ExternalCategory = functions.ExternalCategory;
type TranspileMap = functions.chrome.TranspileMap;
type ChromeModule = functions.settings.ChromeModule;
type ConfigOrTranspiler = functions.internal.ConfigOrTranspiler;
type PluginConfig = functions.internal.PluginConfig;

const validLocalPath = (value: string) => /^\.?\.[\\/]/.test(value);

const Chrome = new class extends Module implements functions.IChrome {
    public settings: ChromeModule = {};

    private _packageMap: ObjectMap<FunctionType<Undef<string>>> = {};

    createOptions(value: Undef<ConfigOrTranspiler>): Undef<ConfigOrTranspiler> {
        if (typeof value === 'string') {
            value = value.trim();
            if (this.settings.eval_function) {
                const transpiler = this.createTranspiler(value);
                if (transpiler) {
                    return transpiler;
                }
            }
            if (typeof value === 'string') {
                return this.createConfig(value);
            }
        }
        return value;
    }
    findPlugin(settings: Undef<ObjectMap<StandardMap>>, value: string): PluginConfig {
        if (settings) {
            for (const name in settings) {
                const data = settings[name];
                for (const plugin in data) {
                    if (plugin === value) {
                        const options = this.createOptions(data[plugin]);
                        const config = this.createConfig(data[plugin + '-config']);
                        if (options || config) {
                            return [name, options, config];
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
                    const options = this.createOptions(item);
                    if (options) {
                        return [name, options, this.createConfig(data[name][value + '-config'])];
                    }
                    break;
                }
            }
        }
        return this.findPlugin(settings, value);
    }
    createTranspiler(value: string): Null<FunctionType<string>> {
        if (validLocalPath(value)) {
            try {
                value = fs.readFileSync(path.resolve(value), 'utf8').trim();
            }
            catch {
                return null;
            }
        }
        return value.startsWith('function') ? eval(`(${value})`) as FunctionType<string> : null;
    }
    createConfig(value: Undef<StandardMap | string>): StandardMap | string {
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
            catch {
            }
        }
        return value || {};
    }
    async transform(type: ExternalCategory, format: string, value: string, transpileMap?: TranspileMap) {
        const data = this.settings[type];
        if (data) {
            let valid: Undef<boolean>;
            const formatters = format.split('+');
            for (let i = 0, length = formatters.length; i < length; ++i) {
                const [name, custom, config] = this.findTranspiler(data, formatters[i].trim(), type, transpileMap);
                if (name) {
                    try {
                        if (typeof custom === 'function') {
                            const result = custom(require(name), value, config);
                            if (result && typeof result === 'string') {
                                if (i === length - 1) {
                                    return result;
                                }
                                value = result;
                                valid = true;
                            }
                        }
                        else {
                            this._packageMap[name] ||= require(`./packages/${name}`).default;
                            const result: Undef<string> = await this._packageMap[name](
                                value,
                                typeof custom === 'object' ? { ...custom } : typeof config === 'object' ? { ...config } : {},
                                typeof config === 'object' ? { ...config } : config
                            );
                            if (result) {
                                if (i === length - 1) {
                                    return result;
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
                return value;
            }
        }
    }
    formatContent(mimeType: string, format: string, value: string, transpileMap?: TranspileMap) {
        if (mimeType.endsWith('text/html')) {
            return this.transform('html', format, value, transpileMap);
        }
        else if (mimeType.endsWith('text/css')) {
            return this.transform('css', format, value, transpileMap);
        }
        else if (mimeType.endsWith('text/javascript')) {
            return this.transform('js', format, value, transpileMap);
        }
        return Promise.resolve();
    }
    removeCss(source: string, styles: string[]) {
        let output: Undef<string>,
            pattern: Undef<RegExp>,
            match: Null<RegExpExecArray>;
        for (let value of styles) {
            value = value.replace(/\./g, '\\.');
            pattern = new RegExp(`^\\s*${value}\\s*\\{[^}]*\\}\\n*`, 'gm');
            while (match = pattern.exec(source)) {
                output = (output || source).replace(match[0], '');
            }
            if (output) {
                source = output;
            }
            pattern = new RegExp(`^[^,]*(,?\\s*${value}\\s*[,{](\\s*)).*?\\{?`, 'gm');
            while (match = pattern.exec(source)) {
                const segment = match[1];
                let replaceWith = '';
                if (segment.trim().endsWith('{')) {
                    replaceWith = ' {' + match[2];
                }
                else if (segment[0] === ',') {
                    replaceWith = ', ';
                }
                output = (output || source).replace(match[0], match[0].replace(segment, replaceWith));
            }
            if (output) {
                source = output;
            }
        }
        return output;
    }
}();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Chrome;
    module.exports.default = Chrome;
    module.exports.__esModule = true;
}

export default Chrome;