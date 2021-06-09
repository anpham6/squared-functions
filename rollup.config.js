export default [
    {
        input: './build/document/index.js',
        treeshake: false,
        output: {
            file: './publish/document/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/document ${require('./publish/document/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/document/parse/index.js',
        treeshake: false,
        output: {
            file: './publish/document/parse/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/document/parse ${require('./publish/document/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/document/parse/dom.js',
        treeshake: false,
        output: {
            file: './publish/document/parse/dom.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/document/parse/dom ${require('./publish/document/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/document/android/index.js',
        treeshake: false,
        output: {
            file: './publish/document/android/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/document/android ${require('./publish/document/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/document/android/extensions/app/manifest/index.js',
        treeshake: false,
        output: {
            file: './publish/document/android/extensions/app/manifest/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/document/android/extensions/app/manifest ${require('./publish/document/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/document/android/extensions/gradle/dependencies/index.js',
        treeshake: false,
        output: {
            file: './publish/document/android/extensions/gradle/dependencies/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/document/android/extensions/gradle/dependencies ${require('./publish/document/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/document/android/extensions/gradle/settings/index.js',
        treeshake: false,
        output: {
            file: './publish/document/android/extensions/gradle/settings/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/document/android/extensions/gradle/settings ${require('./publish/document/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/document/chrome/index.js',
        treeshake: false,
        output: {
            file: './publish/document/chrome/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/document/chrome ${require('./publish/document/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/document/util.js',
        treeshake: false,
        output: {
            file: './publish/document/util.js',
            format: 'cjs',
            strict: false
        }
    },
    {
        input: './build/task/index.js',
        treeshake: false,
        output: {
            file: './publish/task/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/task ${require('./publish/task/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/task/gulp/index.js',
        treeshake: false,
        output: {
            file: './publish/task/gulp/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/task/gulp ${require('./publish/task/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/cloud/index.js',
        treeshake: false,
        output: {
            file: './publish/cloud/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/cloud ${require('./publish/cloud/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/compress/index.js',
        treeshake: false,
        output: {
            file: './publish/compress/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/compress ${require('./publish/compress/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/file-manager/index.js',
        treeshake: false,
        output: {
            file: './publish/file-manager/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/file-manager ${require('./publish/file-manager/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/file-manager/permission/index.js',
        treeshake: false,
        output: {
            file: './publish/file-manager/permission/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/file-manager/permission ${require('./publish/file-manager/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/image/index.js',
        treeshake: false,
        output: {
            file: './publish/image/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/image ${require('./publish/image/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/image/jimp/index.js',
        treeshake: false,
        output: {
            file: './publish/image/jimp/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/image/jimp ${require('./publish/image/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/module/index.js',
        treeshake: false,
        output: {
            file: './publish/module/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/module ${require('./publish/module/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    },
    {
        input: './build/watch/index.js',
        treeshake: false,
        output: {
            file: './publish/watch/index.js',
            format: 'cjs',
            strict: false,
            banner: `/* @squared-functions/watch ${require('./publish/watch/package.json').version}\n   https://github.com/anpham6/squared-functions */\n`
        }
    }
];