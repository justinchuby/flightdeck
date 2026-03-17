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

  // Import boundary: web/ cannot import from server/
  {
    files: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx'],
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
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@flightdeck/server', '@flightdeck/server/*'], message: 'web/ cannot import from server/. Use @flightdeck/shared for shared types.' },
          { group: ['../../server/*', '../../../server/*'], message: 'web/ cannot import from server/ via relative paths.' },
        ],
      }],
    },
  },

  // Import boundary: server/ cannot import from web/
  {
    files: ['packages/server/src/**/*.ts', 'packages/server/src/**/*.tsx'],
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
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@flightdeck/web', '@flightdeck/web/*'], message: 'server/ cannot import from web/. Use @flightdeck/shared for shared types.' },
          { group: ['../../web/*', '../../../web/*'], message: 'server/ cannot import from web/ via relative paths.' },
        ],
      }],
    },
  },
];
