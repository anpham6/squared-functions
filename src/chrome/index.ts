import type { Options as PrettierOptions } from 'prettier';
import type { MergedRollupOptions, OutputAsset, OutputChunk, OutputOptions, RollupBuild } from 'rollup';

import path = require('path');
import fs = require('fs-extra');
import uuid = require('uuid');
import chalk = require('chalk');

import Module from '../module';

type TranspileMap = functions.TranspileMap;
type ChromeModules = functions.ChromeModules;
type ExternalCategory = functions.ExternalCategory;
type ConfigOrTranspiler = functions.internal.ConfigOrTranspiler;
type PluginConfig = functions.internal.PluginConfig;

function setPrettierParser(options: PrettierOptions): PrettierOptions {
    switch (options.parser) {
        case 'babel':
        case 'babel-flow':
        case 'babel-ts':
        case 'json':
        case 'json-5':
        case 'json-stringify':
            options.plugins = [require('prettier/parser-babel')];
            break;
        case 'css':
        case 'scss':
        case 'less':
            options.plugins = [require('prettier/parser-postcss')];
            break;
        case 'flow':
            options.plugins = [require('prettier/parser-flow')];
            break;
        case 'html':
        case 'angular':
        case 'lwc':
        case 'vue':
            options.plugins = [require('prettier/parser-html')];
            break;
        case 'graphql':
            options.plugins = [require('prettier/parser-graphql')];
            break;
        case 'markdown':
            options.plugins = [require('prettier/parser-markdown')];
            break;
        case 'typescript':
            options.plugins = [require('prettier/parser-typescript')];
            break;
        case 'yaml':
            options.plugins = [require('prettier/parser-yaml')];
            break;
        default:
            options.plugins ||= [];
            break;
    }
    return options;
}

const validLocalPath = (value: string) => /^\.?\.[\\/]/.test(value);

const Chrome = new class extends Module implements functions.IChrome {
    public modules: ChromeModules = {};

    createOptions(value: Undef<ConfigOrTranspiler>): Undef<ConfigOrTranspiler> {
        if (typeof value === 'string') {
            value = value.trim();
            if (this.modules.eval_function) {
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
        if (transpileMap && this.modules.eval_text_template) {
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
    async minifyHtml(format: string, value: string, transpileMap?: TranspileMap) {
        const html = this.modules.html;
        if (html) {
            let valid: Undef<boolean>;
            const formatters = format.split('+');
            for (let i = 0, length = formatters.length; i < length; ++i) {
                const [name, custom, config] = this.findTranspiler(html, formatters[i].trim(), 'html', transpileMap);
                if (name) {
                    try {
                        if (typeof custom === 'function') {
                            const result = custom(require(name), value, config);
                            if (result && typeof result === 'string') {
                                if (i === length - 1) {
                                    return Promise.resolve(result);
                                }
                                value = result;
                                valid = true;
                            }
                        }
                        else {
                            const options = typeof custom === 'object' ? { ...custom } : typeof config === 'object' ? config : {};
                            switch (name) {
                                case 'prettier': {
                                    const result: Undef<string> = require('prettier').format(value, setPrettierParser(options));
                                    if (result) {
                                        if (i === length - 1) {
                                            return Promise.resolve(result);
                                        }
                                        value = result;
                                        valid = true;
                                    }
                                    break;
                                }
                                case 'html-minifier':
                                case 'html-minifier-terser': {
                                    const result: Undef<string> = require(name).minify(value, options);
                                    if (result) {
                                        if (i === length - 1) {
                                            return Promise.resolve(result);
                                        }
                                        value = result;
                                        valid = true;
                                    }
                                    break;
                                }
                            }
                        }
                    }
                    catch (err) {
                        this.writeFail(`${chalk.yellow('Install required?')} ${chalk.bold(`[npm i ${name}]`)}`, err);
                    }
                }
            }
            if (valid) {
                return Promise.resolve(value);
            }
        }
        return Promise.resolve();
    }
    async minifyCss(format: string, value: string, transpileMap?: TranspileMap) {
        const css = this.modules.css;
        if (css) {
            let valid: Undef<boolean>;
            const formatters = format.split('+');
            for (let i = 0, length = formatters.length; i < length; ++i) {
                const [name, custom, config] = this.findTranspiler(css, formatters[i].trim(), 'css', transpileMap);
                if (name) {
                    try {
                        if (typeof custom === 'function') {
                            const result = custom(require(name), value, config);
                            if (result && typeof result === 'string') {
                                if (i === length - 1) {
                                    return Promise.resolve(result);
                                }
                                value = result;
                                valid = true;
                            }
                        }
                        else {
                            const options = typeof custom === 'object' ? { ...custom } : typeof config === 'object' ? config : {};
                            switch (name) {
                                case 'prettier': {
                                    const result: Undef<string> = require('prettier').format(value, setPrettierParser(options));
                                    if (result) {
                                        if (i === length - 1) {
                                            return Promise.resolve(result);
                                        }
                                        value = result;
                                        valid = true;
                                    }
                                    break;
                                }
                                case 'clean-css': {
                                    const clean_css = require('clean-css');
                                    const result: Undef<string> = new clean_css(options).minify(value).styles;
                                    if (result) {
                                        if (i === length - 1) {
                                            return Promise.resolve(result);
                                        }
                                        value = result;
                                        valid = true;
                                    }
                                    break;
                                }
                            }
                        }
                    }
                    catch (err) {
                        this.writeFail(`${chalk.yellow('Install required?')} ${chalk.bold(`[npm i ${name}]`)}`, err);
                    }
                }
            }
            if (valid) {
                return Promise.resolve(value);
            }
        }
        return Promise.resolve();
    }
    async minifyJs(format: string, value: string, transpileMap?: TranspileMap) {
        const js = this.modules.js;
        if (js) {
            const formatters = format.split('+');
            let modified: Undef<boolean>;
            for (let i = 0, length = formatters.length; i < length; ++i) {
                const [name, custom, config] = this.findTranspiler(js, formatters[i].trim(), 'js', transpileMap);
                if (name) {
                    try {
                        if (typeof custom === 'function') {
                            const result: Undef<string> = custom(require(name), value, config);
                            if (result && typeof result === 'string') {
                                if (i === length - 1) {
                                    return Promise.resolve(result);
                                }
                                value = result;
                                modified = true;
                            }
                        }
                        else {
                            const options = typeof custom === 'object' ? { ...custom } : typeof config === 'object' ? config : {};
                            switch (name) {
                                case '@babel/core': {
                                    const result: Undef<string> = require('@babel/core').transformSync(value, options).code;
                                    if (result) {
                                        if (i === length - 1) {
                                            return Promise.resolve(result);
                                        }
                                        value = result;
                                        modified = true;
                                    }
                                    break;
                                }
                                case 'prettier': {
                                    const result: Undef<string> = require('prettier').format(value, setPrettierParser(options));
                                    if (result) {
                                        if (i === length - 1) {
                                            return Promise.resolve(result);
                                        }
                                        value = result;
                                        modified = true;
                                    }
                                    break;
                                }
                                case 'terser':
                                case 'uglify-js': {
                                    const terser = require(name);
                                    const result: Undef<string> = (await terser.minify(value, options)).code;
                                    if (result) {
                                        if (i === length - 1) {
                                            return Promise.resolve(result);
                                        }
                                        value = result;
                                        modified = true;
                                    }
                                    break;
                                }
                                case 'rollup': {
                                    const rollup = require('rollup');
                                    const rollupDir = path.join(process.cwd(), 'temp' + path.sep + 'rollup');
                                    const inputFile = rollupDir + path.sep + uuid.v4();
                                    fs.mkdirpSync(rollupDir);
                                    fs.writeFileSync(inputFile, value);
                                    let result = '';
                                    const es: OutputOptions = { format: 'es' };
                                    const appendOutput = (output: (OutputChunk | OutputAsset)[]) => {
                                        for (const item of output) {
                                            if (item.type === 'chunk') {
                                                result += item.code;
                                            }
                                        }
                                    };
                                    if (typeof custom === 'string') {
                                        const fileUri = path.resolve(custom);
                                        if (fs.existsSync(fileUri)) {
                                            await require('rollup/dist/loadConfigFile')(fileUri, es)
                                                .then(async (merged: StandardMap) => {
                                                    merged.warnings.flush();
                                                    for (const rollupOptions of merged.options as MergedRollupOptions[]) {
                                                        rollupOptions.input = inputFile;
                                                        const bundle = await rollup.rollup(rollupOptions) as RollupBuild;
                                                        for (const item of rollupOptions.output) {
                                                            const { output } = await bundle.generate(item);
                                                            appendOutput(output);
                                                        }
                                                    }
                                                });
                                        }
                                    }
                                    else if (typeof custom === 'object') {
                                        options.input = inputFile;
                                        const bundle = await rollup.rollup(options) as RollupBuild;
                                        const { output } = await bundle.generate(typeof config === 'object' ? Object.assign(config, es) : Object.assign(options, es));
                                        appendOutput(output);
                                    }
                                    if (result) {
                                        if (i === length - 1) {
                                            return Promise.resolve(result);
                                        }
                                        value = result;
                                        modified = true;
                                    }
                                }
                            }
                        }
                    }
                    catch (err) {
                        this.writeFail(`${chalk.yellow('Install required?')} ${chalk.bold(`[npm i ${name}]`)}`, err);
                    }
                }
            }
            if (modified) {
                return Promise.resolve(value);
            }
        }
        return Promise.resolve();
    }
    formatContent(mimeType: string, format: string, value: string, transpileMap?: TranspileMap) {
        if (mimeType.endsWith('text/html') || mimeType.endsWith('application/xhtml+xml')) {
            return this.minifyHtml(format, value, transpileMap);
        }
        else if (mimeType.endsWith('text/css')) {
            return this.minifyCss(format, value, transpileMap);
        }
        else if (mimeType.endsWith('text/javascript')) {
            return this.minifyJs(format, value, transpileMap);
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