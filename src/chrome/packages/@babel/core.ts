const context = require('@babel/core');

export default async function (value: string, options: PlainObject) {
    return context.transform(value, options).code;
}