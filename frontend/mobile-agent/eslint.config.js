// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  {
    ignores: ['dist/**', '.expo/**', 'tests/**'],
  },
  expoConfig,
  {
    rules: {
      // Existing screens intentionally load external state on focus/effect.
      // Their cancellation guards prevent stale writes and are covered by tests.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
