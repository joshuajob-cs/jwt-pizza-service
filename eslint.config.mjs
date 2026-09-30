import globals from 'globals';
import pluginJs from '@eslint/js';
import jest from 'eslint-plugin-jest';
import prettier from 'eslint-config-prettier';
import { importX, createNodeResolver } from 'eslint-plugin-import-x';

export default [
  { files: ['**/*.js'], languageOptions: { sourceType: 'commonjs' } },
  { languageOptions: { globals: globals.node } },
  { languageOptions: { globals: globals.jest } },
  pluginJs.configs.recommended,
  // Bug-catchers beyond recommended: no == coercion surprises, no var hoisting, const unless reassigned, { name } over { name: name }.
  {
    rules: {
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
    },
  },
  // require() paths must exist, packages come before local files, and a blank line separates requires from code.
  {
    plugins: { 'import-x': importX },
    settings: { 'import-x/resolver-next': [createNodeResolver()] },
    rules: {
      // config.js is gitignored and CI writes it after lint runs, so it can't be resolved there.
      'import-x/no-unresolved': ['error', { commonjs: true, ignore: ['/config\\.js$'] }],
      'import-x/order': [
        'error',
        {
          groups: [
            ['builtin', 'external'],
            ['parent', 'sibling', 'index'],
          ],
        },
      ],
      'import-x/newline-after-import': 'error',
    },
  },
  // Catches a forgotten test.only (which silently skips every other test in that file in CI), tests with no expect, and duplicate titles.
  {
    files: ['**/*.test.js'],
    ...jest.configs['flat/recommended'],
    rules: {
      ...jest.configs['flat/recommended'].rules,
      'jest/prefer-to-have-length': 'error',
    },
  },
  // Tests set up their data through the API, like a real client. Only testHelpers.js may reach into the database.
  {
    files: ['**/*.test.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value=/database\\.js$/]",
          message: 'Tests set up data through the API. Use testHelpers.js, or explain the exception with eslint-disable-next-line.',
        },
      ],
    },
  },
  // Last, so it turns off any style rule above that would fight Prettier's formatting.
  prettier,
  // After prettier, which turns curly off: an if without braces is how a second line ends up outside the if.
  { rules: { curly: 'error' } },
];
