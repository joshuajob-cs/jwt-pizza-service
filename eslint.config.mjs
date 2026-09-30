import globals from 'globals';
import pluginJs from '@eslint/js';
import jest from 'eslint-plugin-jest';

export default [
  { files: ['**/*.js'], languageOptions: { sourceType: 'commonjs' } },
  { languageOptions: { globals: globals.node } },
  { languageOptions: { globals: globals.jest } },
  pluginJs.configs.recommended,
  // Catches a forgotten test.only (which silently skips the rest of the suite in CI), tests with no expect, and duplicate titles.
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
];
