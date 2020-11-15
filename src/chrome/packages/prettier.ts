const context = require('prettier');

function setPrettierParser(options: PlainObject) {
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

export default async function (value: string, options: ObjectString, config: ObjectString, outputMap: Map<string, ObjectString>) {
    if (typeof options === 'object') {
        const result = context.format(value, setPrettierParser(options));
        if (result) {
            outputMap.set('prettier', result);
            return result;
        }
    }
}