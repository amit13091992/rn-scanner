import type { DependencyInfo } from '../types/dependency.js';
import { isToolingOnlyPackage } from '../data/toolingOnlyPackages.js';
import { walkSourceFiles } from '../utils/sourceFiles.js';
import { readInstalledDependencyManifest } from '../detectors/dependencyCompleteness.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Both plain requires/imports (`require('pkg')`, `from 'pkg'`) and dynamic `import('pkg')`.
const IMPORT_PATTERN = /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:from|import)\s+['"]([^'"]+)['"]/g;

/**
 * Extracts the package name a module specifier resolves to: scoped packages keep their first
 * two path segments (`@scope/name`), everything else keeps its first segment
 * (`name/lib/thing` -> `name`). Relative/absolute specifiers aren't packages at all.
 */
function specifierToPackageName(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  const segments = specifier.split('/');
  if (specifier.startsWith('@') && segments.length > 1) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] ?? null;
}

function collectImportedPackageNames(cwd: string): { imported: Set<string>; filesScanned: number } {
  const imported = new Set<string>();

  const { filesScanned } = walkSourceFiles(cwd, (_filePath, content) => {
    for (const match of content.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      const packageName = specifierToPackageName(specifier);
      if (packageName) imported.add(packageName);
    }
  });

  return { imported, filesScanned };
}

export interface UnusedDependencyResult {
  name: string;
  type: DependencyInfo['type'];
}

export interface ImplicitlyUsedDependency {
  name: string;
  /** Why it counts as used even though no source file imports it. */
  reason: string;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pluginName(entry: unknown): string | null {
  const raw = Array.isArray(entry) ? entry[0] : entry;
  return typeof raw === 'string' ? specifierToPackageName(raw) : null;
}

/**
 * Usage that never shows up as an `import`: the package.json `main` entry (Expo Router's
 * `expo-router/entry`), Expo config plugins in app.json / app.config.json, binaries invoked
 * from package.json scripts, and packages another installed dependency requires as a peer.
 */
function collectImplicitUsage(cwd: string, dependencies: DependencyInfo[]): Map<string, string> {
  const implicit = new Map<string, string>();
  const note = (name: string | null, reason: string) => {
    if (name && !implicit.has(name)) implicit.set(name, reason);
  };

  const pkg = readJson(join(cwd, 'package.json'));
  if (pkg) {
    if (typeof pkg.main === 'string') note(specifierToPackageName(pkg.main), `package.json "main" is "${pkg.main}"`);
    const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
    for (const command of Object.values(scripts)) {
      if (typeof command !== 'string') continue;
      for (const token of command.split(/[\s&|;]+/)) note(specifierToPackageName(token), 'invoked from a package.json script');
    }
  }

  for (const file of ['app.json', 'app.config.json']) {
    const config = readJson(join(cwd, file));
    const expo = (config?.expo ?? config) as Record<string, unknown> | undefined;
    const plugins = expo?.plugins;
    if (Array.isArray(plugins)) plugins.forEach((p) => note(pluginName(p), `Expo config plugin in ${file}`));
    if (expo && typeof expo === 'object') note('expo', `Expo project (${file})`);
  }
  // app.config.js/ts can't be evaluated safely; fall back to a textual match for plugin names.
  for (const file of ['app.config.js', 'app.config.ts', 'babel.config.js', 'metro.config.js', 'tailwind.config.js', 'postcss.config.js']) {
    try {
      const text = readFileSync(join(cwd, file), 'utf-8');
      for (const dep of dependencies) {
        if (text.includes(`'${dep.name}`) || text.includes(`"${dep.name}`)) note(dep.name, `referenced from ${file}`);
      }
    } catch { /* file absent */ }
  }

  const declared = new Set(dependencies.map((d) => d.name));
  for (const dep of dependencies) {
    const manifest = readInstalledDependencyManifest(cwd, dep.name);
    if (!manifest) continue;
    for (const peer of Object.keys(manifest.peerDependencies)) {
      // An optional peer is not required by the package, so it says nothing about whether the app needs it.
      if (manifest.peerDependenciesMeta[peer]?.optional === true) continue;
      if (declared.has(peer) && peer !== dep.name) note(peer, `peer dependency of ${dep.name}`);
    }
  }

  // Expo Router resolves screens from the app/ directory, so its imports and its required
  // peers never need to appear in source. `expo` itself is the CLI/runtime for the project.
  if (implicit.has('expo-router') || declared.has('expo-router')) {
    const routerManifest = readInstalledDependencyManifest(cwd, 'expo-router');
    note('expo-router', 'Expo Router entry / file-based routing');
    for (const peer of Object.keys(routerManifest?.peerDependencies ?? {})) {
      if (routerManifest?.peerDependenciesMeta[peer]?.optional === true) continue;
      if (declared.has(peer)) note(peer, 'peer dependency of expo-router');
    }
  }

  // Navigation runtimes need these linked natively even when app code never imports them
  // (gesture-handler is only a side-effect import in the entry file, and Expo Router apps skip it).
  const usesNavigation = [...declared].some((n) => n === 'expo-router' || n.startsWith('@react-navigation/'));
  if (usesNavigation) {
    for (const companion of ['react-native-gesture-handler', 'react-native-screens', 'react-native-safe-area-context']) {
      if (declared.has(companion)) note(companion, 'native companion of the navigation library');
    }
  }
  return implicit;
}

export interface UnusedDependenciesResult {
  implicitlyUsed: ImplicitlyUsedDependency[];
  unused: UnusedDependencyResult[];
  /** Packages excluded from the scan as known tooling-only (never imported from source) — for
   *  transparency about what was deliberately not flagged, not itself a problem to report. */
  excludedAsTooling: string[];
  filesScanned: number;
}

/**
 * Flags declared dependencies with no detected `require`/`import` anywhere in project source.
 * Heuristic, not proof: a package used only from a config file (Metro, Babel, native build
 * scripts) that isn't in `data/toolingOnlyPackages.ts`'s curated exclude list will still be a
 * false positive here — this is a starting point for manual review, not an automatic-removal
 * tool, so results are reported as "no import found", never as "safe to delete".
 */
export function analyzeUnusedDependencies(cwd: string, dependencies: DependencyInfo[]): UnusedDependenciesResult {
  const { imported, filesScanned } = collectImportedPackageNames(cwd);

  const implicit = collectImplicitUsage(cwd, dependencies);
  const implicitlyUsed: ImplicitlyUsedDependency[] = [];
  const unused: UnusedDependencyResult[] = [];
  const excludedAsTooling: string[] = [];

  for (const dep of dependencies) {
    if (dep.type === 'peerDependency' || dep.type === 'optionalDependency') continue;
    if (isToolingOnlyPackage(dep.name)) {
      excludedAsTooling.push(dep.name);
      continue;
    }
    if (!imported.has(dep.name) && implicit.has(dep.name)) {
      implicitlyUsed.push({ name: dep.name, reason: implicit.get(dep.name)! });
      continue;
    }
    if (!imported.has(dep.name)) {
      unused.push({ name: dep.name, type: dep.type });
    }
  }

  return { unused, implicitlyUsed, excludedAsTooling, filesScanned };
}
