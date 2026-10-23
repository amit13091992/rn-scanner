/**
 * Packages that are legitimately never `require`/`import`ed from application source — they're
 * invoked via config file, CLI, or build pipeline instead (an ESLint plugin named in
 * `.eslintrc`, a Babel preset named in `babel.config.js`, `typescript` itself, etc.). Flagging
 * these as "unused" would be a false positive, so `analyzeUnusedDependencies` excludes any
 * package matching one of these patterns from its report entirely (not merely deprioritizes it).
 * Same curated, hand-maintained shape as `data/deprecatedPackages.ts` — expect to extend this
 * list as real-world false positives are reported, not treat it as exhaustive.
 */
export const TOOLING_ONLY_PACKAGE_PATTERNS: RegExp[] = [
  /^@types\//,
  /^eslint(-|$)/,
  /^@typescript-eslint\//,
  /^babel-/,
  /^@babel\//,
  /^prettier/,
  /^jest(-|$)/,
  /^@testing-library\//,
  /^typescript$/,
  /^ts-node$/,
  /^tsx$/,
  /^metro(-|$)/,
  /^@react-native-community\/cli/,
  /^@react-native\/(babel-preset|metro-config|eslint-config|typescript-config|gradle-plugin)/,
  /^husky$/,
  /^lint-staged$/,
  /^nodemon$/,
  /^patch-package$/,
  /^rn-dep-scanner$/,
];

export function isToolingOnlyPackage(name: string): boolean {
  return TOOLING_ONLY_PACKAGE_PATTERNS.some((pattern) => pattern.test(name));
}
