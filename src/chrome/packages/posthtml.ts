const context = require('posthtml');

export default async function (value: string, options: PlainObject, config: PlainObject) {
    if (Array.isArray(options.plugins)) {
        const plugins = options.plugins.filter(item => Array.isArray(item) && item.length);
        if (plugins.length) {
            const result = await context(options.plugins.map(item => require(item[0])(item[1]))).process(value, config);
            if (result) {
                return result.html;
            }
        }
    }
}