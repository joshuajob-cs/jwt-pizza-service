import globals from 'globals';
import pluginJs from '@eslint/js';

export default [
  { files: ['**/*.js'], languageOptions: { sourceType: 'commonjs' } },
  { languageOptions: { globals: globals.node } },
  { languageOptions: { globals: globals.jest } },
  pluginJs.configs.recommended,
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
