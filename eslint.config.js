// @ts-check
import js from '@eslint/js';
import globals from 'globals';

/**
 * Lints the project's plain-JS files (build/fixture/CI scripts under `scripts/`, this config
 * file itself). `src/**` and `test/**` are TypeScript and intentionally NOT linted here yet —
 * `typescript-eslint`/`@typescript-eslint/parser` both hard-refuse to run against this
 * project's installed TypeScript 7.x (https://github.com/typescript-eslint/typescript-eslint/issues/10940),
 * and that guard fires at module load regardless of whether type-aware rules are even
 * requested, so there's no partial/degraded mode to fall back to today. `tsc --strict` (see
 * `npm run build`) remains the static check covering `src`/`test` until that upstream support
 * lands — re-add `@typescript-eslint/parser` + `eslint-plugin` and extend `files` below once it
 * does.
 */
export default [
  js.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/**', 'test/**', '.claude/**'],
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
    },
  },
];
