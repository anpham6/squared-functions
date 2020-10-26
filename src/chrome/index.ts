import type { Options as PrettierOptions } from 'prettier';

import path = require('path');
import fs = require('fs');
import chalk = require('chalk');

import Module from '../module';

type TranspileMap = functions.TranspileMap;

export default new class extends Module implements functions.IChrome {
    public modules: Undef<functions.ChromeModules>;

    findPlugin(data: ObjectMap<StandardMap>, name: string): [string, StandardMap | FunctionType<string>] {
        for (const module in data) {
            const plugin = data[module];
            for (const custom in plugin) {
                if (custom === name) {
                    let options: StandardMap | string = plugin[custom];
                    if (!options) {
                        options = {};
                    }
                    else if (typeof options === 'string') {
                        if (this.modules?.eval_function) {
                            options = options.trim();
                            if (options) {
                                const result = this.createTranspiler(options);
                                if (result) {
                                    return [module, result];
                                }
                            }
                        }
                        break;
                    }
                    else if (typeof options !== 'object') {
                        break;
                    }
                    return [module, options];
                }
            }
        }
        return ['', {}];
    }
    findTranspiler(config: ObjectMap<StandardMap>, name: string, category: functions.ExternalCategory, transpileMap?: TranspileMap): [string, StandardMap | FunctionType<string>] {
        if (transpileMap && this.modules?.eval_text_template) {
            const data = transpileMap[category];
            for (const attr in data) {
                const item = data[attr][name];
                if (item) {
                    const result = this.createTranspiler(item);
                    if (result) {
                        return [attr, result];
                    }
                    break;
                }
            }
        }
        return this.findPlugin(config, name);
    }
    createTranspiler(value: string): Null<FunctionType<string>> {
        if (value.startsWith('./')) {
            try {
                value = fs.readFileSync(path.resolve(value), 'utf8').trim();
            }
            catch {
                return null;
            }
        }
        return value.startsWith('function') ? eval(`(${value})`) : new Function('context', 'value', value);
    }
    setPrettierOptions(options: PrettierOptions): PrettierOptions {
        switch (options.parser || '') {
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
                options.plugins = [];
                break;
        }
        return options;
    }
    async minifyHtml(format: string, value: string, transpileMap?: TranspileMap) {
        const html = this.modules?.html;
        if (html) {
            let valid: Undef<boolean>;
            const formatters = format.split('+');
            for (let i = 0, length = formatters.length; i < length; ++i) {
                const [module, options] = this.findTranspiler(html, formatters[i].trim(), 'html', transpileMap);
                if (module) {
                    try {
                        if (typeof options === 'function') {
                            const result = options(require(module), value);
                            if (result && typeof result === 'string') {
                                if (i === length - 1) {
                                    return Promise.resolve(result);
                                }
                                value = result;
                                valid = true;
                            }
                        }
                        else {
                            switch (module) {
                                case 'prettier': {
                                    const result: Undef<string> = require('prettier').format(value, this.setPrettierOptions(options));
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
                                    const result: Undef<string> = require(module).minify(value, options);
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
                        this.writeFail(`${chalk.yellow('Install required')} -> ${chalk.bold(`[npm i ${module}]`)}`, err);
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
        const css = this.modules?.css;
        if (css) {
            let valid: Undef<boolean>;
            const formatters = format.split('+');
            for (let i = 0, length = formatters.length; i < length; ++i) {
                const [module, options] = this.findTranspiler(css, formatters[i].trim(), 'css', transpileMap);
                if (module) {
                    try {
                        if (typeof options === 'function') {
                            const result = options(require(module), value);
                            if (result && typeof result === 'string') {
                                if (i === length - 1) {
                                    return Promise.resolve(result);
                                }
                                value = result;
                                valid = true;
                            }
                        }
                        else {
                            switch (module) {
                                case 'prettier': {
                                    const result: Undef<string> = require('prettier').format(value, this.setPrettierOptions(options));
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
                        this.writeFail(`${chalk.yellow('Install required')} -> ${chalk.bold(`[npm i ${module}]`)}`, err);
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
        const js = this.modules?.js;
        if (js) {
            const formatters = format.split('+');
            let modified: Undef<boolean>;
            for (let i = 0, length = formatters.length; i < length; ++i) {
                const [module, options] = this.findTranspiler(js, formatters[i].trim(), 'js', transpileMap);
                if (module) {
                    try {
                        if (typeof options === 'function') {
                            const result: Undef<string> = options(require(module), value);
                            if (result && typeof result === 'string') {
                                if (i === length - 1) {
                                    return Promise.resolve(result);
                                }
                                value = result;
                                modified = true;
                            }
                        }
                        else {
                            switch (module) {
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
                                    const result: Undef<string> = require('prettier').format(value, this.setPrettierOptions(options));
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
                                    const terser = require(module);
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
                            }
                        }
                    }
                    catch (err) {
                        this.writeFail(`${chalk.yellow('Install required')} -> ${chalk.bold(`[npm i ${module}]`)}`, err);
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
            modified: Undef<boolean>,
            pattern: Undef<RegExp>,
            match: Null<RegExpExecArray>;
        for (let value of styles) {
            value = value.replace(/\./g, '\\.');
            pattern = new RegExp(`^\\s*${value}\\s*\\{[\\s\\S]*?\\}\\n*`, 'gm');
            while (match = pattern.exec(source)) {
                output = (output || source).replace(match[0], '');
                modified = true;
            }
            if (modified) {
                source = output!;
                modified = false;
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
                modified = true;
            }
            if (modified) {
                source = output!;
                modified = false;
            }
        }
        return output;
    }
}();