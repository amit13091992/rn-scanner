import { getNewArchInfo } from '../data/newArchitecture.js';
import type { DependencyInfo } from '../types/dependency.js';

export interface RenovateConfigResult {
  config: Record<string, unknown>;
  nativeModuleCount: number;
  /** Direct packages flagged unsupported on the New Architecture at the currently installed
   *  React Native version — surfaced as their own Renovate group so an update that might fix
   *  compatibility isn't buried in a routine dependency-update PR. */
  reviewFlagged: string[];
}

/** Matches `react-native-*`, `@react-native-community/*`, `@react-navigation/*` — the same
 *  "likely ships native code" heuristic `analyzers/newArchitecture.ts` uses, reused here so
 *  both features agree on what counts as a native module worth grouping/reviewing separately. */
const NATIVE_MODULE_PATTERN = '^(react-native-|@react-native-community/|@react-navigation/)';
const CORE_PACKAGES = ['react-native', 'react', 'react-dom', 'expo'];

/**
 * Generates a starter Renovate config tailored to a React Native project: groups
 * React/React Native/Expo core packages together (they must stay version-locked, never
 * auto-updated independently), groups native modules into their own slower-reviewed group
 * (a native-module update can break at runtime without a type error, so it deserves more
 * scrutiny than a pure-JS dependency bump), and gives any package this project's own New
 * Architecture data (`data/newArchitecture.ts`) already flags as unsupported a dedicated
 * high-priority group — an update to one of those might *be* the fix. Respects this project's
 * own `ignorePackages` (`.rn-preflight.json`) by excluding them from Renovate entirely via
 * `ignoreDeps`. Pure data transformation — no network call, no new dependency (plain JSON).
 */
export function buildRenovateConfig(
  dependencies: DependencyInfo[],
  reactNativeVersion: string | null,
  ignorePackages: string[] = []
): RenovateConfigResult {
  const directNames = dependencies
    .filter((d) => d.type === 'dependency' || d.type === 'devDependency')
    .map((d) => d.name);

  const nativeModulePattern = new RegExp(NATIVE_MODULE_PATTERN);
  const nativeModuleNames = directNames.filter((name) => nativeModulePattern.test(name));
  const corePackageNames = CORE_PACKAGES.filter((name) => directNames.includes(name));

  const reviewFlagged = directNames.filter((name) => {
    const info = getNewArchInfo(name);
    return info?.support === 'unsupported';
  });

  const packageRules: Record<string, unknown>[] = [];

  if (corePackageNames.length > 0) {
    packageRules.push({
      groupName: 'React Native core',
      matchPackageNames: corePackageNames,
      description: 'react-native/react/react-dom/expo must stay version-locked together — review as one PR, never auto-merge.',
    });
  }

  if (nativeModuleNames.length > 0) {
    packageRules.push({
      groupName: 'Native modules (requires a native rebuild)',
      matchPackageNames: [`/${NATIVE_MODULE_PATTERN}/`],
      description: 'Ships native Android/iOS code — can break at runtime without a type error, so review the changelog before merging.',
    });
  }

  if (reviewFlagged.length > 0) {
    packageRules.push({
      groupName: 'New Architecture review needed',
      matchPackageNames: reviewFlagged,
      labels: ['new-architecture-review'],
      prPriority: 5,
      description: `rn-preflight flagged these as unsupported on the New Architecture${
        reactNativeVersion ? ` at the installed React Native ${reactNativeVersion}` : ''
      } — an update may fix this, so prioritize reviewing it.`,
    });
  }

  const config: Record<string, unknown> = {
    $schema: 'https://docs.renovatebot.com/renovate-schema.json',
    extends: ['config:recommended'],
    ...(packageRules.length > 0 ? { packageRules } : {}),
    ...(ignorePackages.length > 0 ? { ignoreDeps: ignorePackages } : {}),
  };

  return { config, nativeModuleCount: nativeModuleNames.length, reviewFlagged };
}
