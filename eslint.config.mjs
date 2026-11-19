import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
    {
        ignores: [
            'node_modules/**',
            'main.js',
            'tests/.build/**',
            '.npm-cache/**',
            'eslint.config.mjs',
            'esbuild.config.mjs',
            'version-bump.mjs',
            'scripts/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    ...obsidianmd.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // The plugin intentionally writes diagnostics to the developer console
            // on recoverable failures; errors and warnings stay allowed.
            'no-console': ['error', { allow: ['warn', 'error'] }],
            // `void promise` is the established explicit-ignore idiom in this codebase.
            '@typescript-eslint/no-floating-promises': [
                'error',
                { ignoreVoid: true },
            ],
            // DOM handlers commonly receive async callbacks wrapped in `void`.
            '@typescript-eslint/no-misused-promises': [
                'error',
                { checksVoidReturn: false },
            ],
            // Sentence case is reviewed separately in R7; the existing UI copy
            // predates this rule and changing it is not a refactor.
            'obsidianmd/ui/sentence-case': 'off',
        },
    },
];
