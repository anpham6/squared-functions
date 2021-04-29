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
        input: './build/cloud/aws-v3/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/aws-v3/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/aws-v3 ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/aws-v3/upload/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/aws-v3/upload/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/aws-v3/upload ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/aws-v3/download/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/aws-v3/download/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/aws-v3/download ${version}\n   https://github.com/anpham6/squared-functions */\n`
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
        input: './build/cloud/gcloud/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/gcloud/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/gcloud ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/gcloud/upload/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/gcloud/upload/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/gcloud/upload ${version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/gcloud/download/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/gcloud/download/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud/gcloud/download ${version}\n   https://github.com/anpham6/squared-functions */\n`
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