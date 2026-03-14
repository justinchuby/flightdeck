import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
    ignores: ['**/dist/**', '**/node_modules/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Catch unused variables (allow underscore-prefixed intentional ignores)
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // Basic code quality
      'no-console': 'off',
      'no-debugger': 'warn',
      'prefer-const': 'warn',
    },
  },
];
