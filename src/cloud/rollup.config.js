const version = require('../../publish/cloud/package.json').version;

export default [
    {
        input: './build/cloud/s3-upload/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/s3-upload/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/s3-upload ${version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/cloud/s3-client/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/s3-client/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/s3-client ${version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    }
];