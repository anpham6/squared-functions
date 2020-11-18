const version = require('../../publish/cloud/package.json').version;

export default [
    {
        input: './build/cloud/s3/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/s3/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/s3 ${version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/cloud/s3/upload/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/s3/upload/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/s3/upload ${version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/cloud/azure/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/azure/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/azure ${version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/cloud/azure/upload/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/azure/upload/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/azure/upload ${version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/cloud/gcs/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/gcs/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/gcs ${version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/cloud/gcs/upload/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/gcs/upload/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/gcs/upload ${version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/cloud/oci/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/oci/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/oci ${version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/cloud/oci/upload/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/oci/upload/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/oci/upload ${version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    }
];