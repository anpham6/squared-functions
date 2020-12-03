const version = require('../../publish/cloud/package.json').version;

export default [
    {
        input: './build/cloud/aws/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/aws/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/aws ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/aws/upload/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/aws/upload/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/aws/upload ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/aws/download/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/aws/download/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/aws/download ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/azure/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/azure/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/azure ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/azure/upload/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/azure/upload/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/azure/upload ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/azure/download/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/azure/download/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/azure/download ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/gcs/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/gcs/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/gcs ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/gcs/upload/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/gcs/upload/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/gcs/upload ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/gcs/download/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/gcs/download/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/gcs/download ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/oci/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/oci/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/oci ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/oci/upload/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/oci/upload/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/oci/upload ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/oci/download/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/oci/download/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/oci/download ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/ibm/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/ibm/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/ibm ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/ibm/upload/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/ibm/upload/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/ibm/upload ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/ibm/download/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/ibm/download/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/ibm/download ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    }
];