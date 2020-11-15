export default [
    {
        input: './build/chrome/packages/@babel/core.js',
        treeshake: false,
        output: {
            file: './publish/chrome/packages/@babel/core.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/chrome/packages/clean-css.js',
        treeshake: false,
        output: {
            file: './publish/chrome/packages/clean-css.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/chrome/packages/html-minifier-terser.js',
        treeshake: false,
        output: {
            file: './publish/chrome/packages/html-minifier-terser.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/chrome/packages/html-minifier.js',
        treeshake: false,
        output: {
            file: './publish/chrome/packages/html-minifier.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/chrome/packages/postcss.js',
        treeshake: false,
        output: {
            file: './publish/chrome/packages/postcss.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/chrome/packages/prettier.js',
        treeshake: false,
        output: {
            file: './publish/chrome/packages/prettier.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/chrome/packages/rollup.js',
        treeshake: false,
        output: {
            file: './publish/chrome/packages/rollup.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/chrome/packages/terser.js',
        treeshake: false,
        output: {
            file: './publish/chrome/packages/terser.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/chrome/packages/uglify-js.js',
        treeshake: false,
        output: {
            file: './publish/chrome/packages/uglify-js.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    }
];