module.exports = {
    "env": {
        "es2017": true,
        "commonjs": true,
        "node": true
    },
    "extends": [
        "eslint:recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:@typescript-eslint/recommended-requiring-type-checking"
    ],
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "project": "tsconfig.json",
        "sourceType": "module"
    },
    "plugins": [
        "@typescript-eslint"
    ],
    "rules": {
        "arrow-parens": ["error", "as-needed"],
        "block-scoped-var": "error",
        "comma-dangle": "error",
        "comma-spacing": "error",
        "comma-style": "error",
        "eqeqeq": "error",
        "id-match": "error",
        "multiline-ternary": ["error", "always-multiline"],
        "new-parens": "error",
        "no-caller": "error",
        "no-cond-assign": "off",
        "no-console": "off",
        "no-constant-condition": "off",
        "no-duplicate-imports": "off",
        "no-else-return": "error",
        "no-empty": "off",
        "no-eval": "off",
        "no-extra-bind": "error",
        "no-fallthrough": "off",
        "no-implicit-globals": "error",
        "no-lonely-if": "error",
        "no-loss-of-precision": "error",
        "no-multi-spaces": "error",
        "no-new-wrappers": "error",
        "no-shadow": ["error", {
            "allow": [
                "LOG_TYPE",
                "settings"
            ]
        }],
        "no-throw-literal": "error",
        "no-trailing-spaces": "error",
        "no-undef-init": "error",
        "no-underscore-dangle": "off",
        "no-unmodified-loop-condition": "error",
        "no-unreachable-loop": "off",
        "no-unused-expressions": "error",
        "no-unused-vars": "off",
        "no-useless-backreference": "error",
        "no-useless-call": "error",
        "no-useless-escape": "error",
        "no-useless-return": "error",
        "no-var": "error",
        "object-shorthand": ["error", "always", { "avoidQuotes": true }],
        "prefer-arrow-callback": "error",
        "prefer-const": "error",
        "prefer-regex-literals": "error",
        "prefer-spread": "error",
        "require-atomic-updates": "off",
        "semi": "error",
        "semi-spacing": "error",
        "semi-style": "error",
        "sort-imports": ["error", {
            "ignoreDeclarationSort": true,
            "memberSyntaxSortOrder": ["none", "single", "all", "multiple"]
        }],
        "@typescript-eslint/await-thenable": "off",
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "@typescript-eslint/no-empty-function": "off",
        "@typescript-eslint/no-empty-interface": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/no-misused-promises": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/no-unused-vars": "off",
        "@typescript-eslint/no-var-requires": "off",
        "@typescript-eslint/restrict-plus-operands": "off",
        "@typescript-eslint/require-await": "off",
        "@typescript-eslint/triple-slash-reference": "off",
        "@typescript-eslint/consistent-type-assertions": "error",
        "@typescript-eslint/consistent-type-definitions": "error",
        "@typescript-eslint/consistent-type-imports": "error",
        "@typescript-eslint/member-delimiter-style": "error",
        "@typescript-eslint/member-ordering": ["error", {
            "default": [
                "static-field",
                "static-method",
                "public-method",
                "protected-method",
                "private-method"
            ]
        }],
        "@typescript-eslint/no-extra-parens": ["error", "all", {
            "conditionalAssign": true,
            "returnAssign": true,
            "nestedBinaryExpressions": false
        }],
        "@typescript-eslint/no-redeclare": "error",
        "@typescript-eslint/no-unnecessary-boolean-literal-compare": "error",
        "@typescript-eslint/no-unnecessary-qualifier": "error",
        "@typescript-eslint/no-unnecessary-type-arguments": "error",
        "@typescript-eslint/no-unnecessary-type-assertion": "error",
        "@typescript-eslint/no-unnecessary-type-constraint": "error",
        "@typescript-eslint/prefer-for-of": "error",
        "@typescript-eslint/unified-signatures": "error"
    }
};