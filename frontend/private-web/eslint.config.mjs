import { defineConfig, globalIgnores } from 'eslint/config';
import next from 'eslint-config-next';
import reactHooks from 'eslint-plugin-react-hooks';

const existingReactBehaviorRules = Object.fromEntries(
  Object.keys(reactHooks.configs.recommended.rules).map(rule => [
    rule,
    rule === 'react-hooks/rules-of-hooks' ? 'error' : 'warn',
  ]),
);

export default defineConfig([
  ...next,
  { rules: existingReactBehaviorRules },
  globalIgnores([
    '.next/**', 'out/**', 'dist/**', 'coverage/**', 'next-env.d.ts',
    'Elevant Login HTML/**', 'public/**',
  ]),
]);
