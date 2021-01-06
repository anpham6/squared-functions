export default [
    {
        input: './build/document/packages/@babel/core.js',
        treeshake: false,
        output: {
            file: './publish/document/packages/@babel/core.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/document/packages/clean-css.js',
        treeshake: false,
        output: {
            file: './publish/document/packages/clean-css.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/document/packages/html-minifier-terser.js',
        treeshake: false,
        output: {
            file: './publish/document/packages/html-minifier-terser.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/document/packages/html-minifier.js',
        treeshake: false,
        output: {
            file: './publish/document/packages/html-minifier.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/document/packages/posthtml.js',
        treeshake: false,
        output: {
            file: './publish/document/packages/posthtml.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/document/packages/postcss.js',
        treeshake: false,
        output: {
            file: './publish/document/packages/postcss.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/document/packages/prettier.js',
        treeshake: false,
        output: {
            file: './publish/document/packages/prettier.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/document/packages/rollup.js',
        treeshake: false,
        output: {
            file: './publish/document/packages/rollup.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/document/packages/terser.js',
        treeshake: false,
        output: {
            file: './publish/document/packages/terser.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    },
    {
        input: './build/document/packages/uglify-js.js',
        treeshake: false,
        output: {
            file: './publish/document/packages/uglify-js.js',
            format: 'cjs',
            strict: false
        },
        plugins: []
    }
];