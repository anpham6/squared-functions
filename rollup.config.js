export default [
    {
        input: './build/chrome/index.js',
        treeshake: false,
        output: {
            file: './publish/chrome/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/chrome ${require('./publish/chrome/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/cloud/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud ${require('./publish/cloud/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/compress/index.js',
        treeshake: false,
        output: {
            file: './publish/compress/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/compress ${require('./publish/compress/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/file-manager/index.js',
        treeshake: false,
        output: {
            file: './publish/file-manager/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/file-manager ${require('./publish/file-manager/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/image/index.js',
        treeshake: false,
        output: {
            file: './publish/image/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/image ${require('./publish/image/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/module/index.js',
        treeshake: false,
        output: {
            file: './publish/module/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/module ${require('./publish/module/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    },
    {
        input: './build/node/index.js',
        treeshake: false,
        output: {
            file: './publish/node/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/node ${require('./publish/node/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        },
        plugins: []
    }
];