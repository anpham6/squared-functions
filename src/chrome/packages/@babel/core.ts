const context = require('@babel/core');

export default async function (value: string, options: ObjectString, config: ObjectString, outputMap: Map<string, ObjectString>) {
    const result = context.transform(value, options);
    if (result) {
        outputMap.set('@babel/core', result);
        return result.code;
    }
}