# rn-dep-scanner Phase 2 Implementation Roadmap

**Version Target**: v2.0.0  
**Timeline**: 6-8 weeks (sequential delivery)  
**Status**: Design Phase Complete

---

## Executive Summary

Phase 2 extends rn-dep-scanner from a single-package-manager CLI to a comprehensive multi-manager dependency analyzer with transitive scanning, conflict detection, and an enhanced breaking change database. The implementation focuses on production-ready features with full test coverage.

### Key Deliverables
1. **Lockfile Parsers** for Yarn, pnpm, and Bun (npm already complete)
2. **Transitive Dependency Scanning** with conflict detection
3. **Duplicate/Multiple Version Detection** with severity classification
4. **Enhanced Breaking Change Database** with 50+ packages
5. **Improved Error Handling** with contextual messages

---

## Feature 1: Complete Lockfile Parsing (Week 1-2)

### Context
Currently, only npm lockfile parsing is fully functional. Yarn, pnpm, and Bun parsers are stubs that need production-ready implementations. These are critical for multi-workspace project support.

### 1.1 Yarn v1/v2/v3 Lockfile Parser

**Files to Modify/Create:**
- `/src/parsers/yarnLockParser.ts` (rewrite)
- `/src/types/lockfile.ts` (extend with yarn-specific types)
- `/test/parsers/yarnLockParser.test.ts` (new)

**Implementation Approach:**

The Yarn lockfile format varies significantly across versions:
- **v1 (classic)**: Text-based format with package entries separated by blank lines
- **v2+**: YAML-based format with different structure for workspaces

```typescript
// Target output for all Yarn versions
export interface YarnLockEntry {
  packageName: string;
  requestedRange: string;           // e.g., "^1.2.3"
  resolvedVersion: string;          // e.g., "1.2.5"
  resolved: string;                 // URL to package registry
  integrity: string;                // integrity hash
  dependencies?: Map<string, string>; // transitive deps
  isDev?: boolean;
  isOptional?: boolean;
}

// Workspace detection for monorepos
export interface YarnWorkspaceInfo {
  isWorkspace: boolean;
  workspaces?: string[];           // e.g., ["packages/*", "apps/*"]
}
```

**Parser Implementation Strategy:**

1. **Version Detection**: Read first lines to identify Yarn version
   - v1: Text-based format, no `# yarn` header
   - v2+: Contains `# yarn` at top or `__metadata` entries
   
2. **v1 Parser**:
   - Split by `\n\n` to get entries
   - Parse package@range header
   - Extract version, resolved, integrity from indented properties
   - Map transitive dependencies
   
3. **v2+ Parser**:
   - Parse YAML structure
   - Handle nested package refs
   - Extract workspace info from `workspaces` field
   
4. **Workspace Handling**:
   - Detect `workspaces` field in root entry
   - For monorepos, map workspace packages to their dependencies
   - Store workspace paths for later transitive analysis

**Key Challenges:**
- Yarn v1 has unstable format across minor versions
- v2+ YAML with custom markers requires careful parsing
- Workspace resolution differs from flat dependencies

**Testing Requirements:**
- Test data: Real yarn.lock files from v1, v2, v3 projects
- Edge cases:
  - Scoped packages (`@babel/core@^7.0.0`)
  - Resolved URLs (npm, GitHub, file)
  - Optional and dev dependencies
  - Monorepo workspaces with cross-references
  - Circular dependencies

**Complexity**: **HIGH** (4-5 days)
- Complex format variations
- Workspace support adds significant logic
- Test data collection time

---

### 1.2 pnpm Lockfile Parser

**Files to Modify/Create:**
- `/src/parsers/pnpmLockParser.ts` (rewrite)
- `/src/types/lockfile.ts` (extend with pnpm types)
- `/test/parsers/pnpmLockParser.test.ts` (new)

**Implementation Approach:**

pnpm uses a single pnpm-lock.yaml file with a flat dependency tree. Structure:

```yaml
lockfileVersion: 5.4
dependencies:
  react: ^18.0.0
  react-native: ^0.72.0
packages:
  react@18.2.0:
    resolution: {integrity: sha512-...}
    dependencies:
      react-dom: 18.2.0
  react-native@0.72.5:
    resolution: {integrity: sha512-...}
    dependencies:
      react: ^18.0.0
```

**Parser Implementation Strategy:**

1. **Format Recognition**:
   - Check `lockfileVersion` field (5.3+)
   - Identify if monorepo (`importers` field for workspaces)
   
2. **Dependency Extraction**:
   - Parse `dependencies` section (direct deps)
   - Parse `packages` section (resolved versions)
   - Cross-reference by version specifier
   
3. **Monorepo Support**:
   - Parse `importers` field (workspace packages)
   - For each workspace, extract local + hoisted dependencies
   
4. **Hoisting Mapping**:
   - pnpm uses "hoisting" - resolve which version is used
   - Track node_modules path structure

**Key Challenges:**
- pnpm uses semantic versioning notation in package keys (e.g., `react@18.2.0`)
- Multiple versions of same package stored differently
- Monorepo importers field requires special handling
- Peer dependency resolution is complex

**Testing Requirements:**
- Test data: Real pnpm-lock.yaml files
- Edge cases:
  - Lockfile versions 5.1-latest
  - Monorepo with multiple workspaces
  - Peer dependency specs
  - Hoisted vs non-hoisted packages
  - Missing packages (incomplete lockfiles)

**Complexity**: **MEDIUM** (3-4 days)
- YAML structure is more uniform than Yarn
- Monorepo complexity lower than Yarn
- Hoisting logic requires careful testing

---

### 1.3 Bun Lockfile Parser

**Files to Modify/Create:**
- `/src/parsers/bunLockParser.ts` (rewrite)
- `/src/types/lockfile.ts` (extend with Bun types)
- `/test/parsers/bunLockParser.test.ts` (new)

**Implementation Approach:**

Bun uses a binary lockfile format (since v1.0+) but also supports text format. The text format is similar to Yarn v1.

```
# bun.lock v6
re@^1.0.0:
  version "1.0.5"
  resolved "https://registry.npmjs.org/re/-/re-1.0.5.tgz"
  integrity sha512-...
  
react@^18.0.0:
  version "18.2.5"
  resolved "https://registry.npmjs.org/react/-/react-18.2.5.tgz"
  integrity sha512-...
  dependencies:
    loose-envify "^1.1.0"
```

**Parser Implementation Strategy:**

1. **Format Detection**:
   - Check for binary magic bytes (Bun v1+)
   - Fall back to text format parsing
   
2. **Text Parser**:
   - Similar to Yarn v1 but simpler structure
   - Header line: `# bun.lock v{version}`
   - Each entry: `package@range:\n  version "...\n  resolved "..."\n  dependencies: ...`
   
3. **Binary Format Handling**:
   - For now: graceful fallback to package.json only
   - Future: implement binary parser with proper library

**Key Challenges:**
- Bun's binary format is proprietary and evolving
- Limited documentation on binary structure
- Text format less stable than Yarn/pnpm

**Testing Requirements:**
- Test data: Text format from Bun projects
- Edge cases:
  - Bun lockfile versions 5-latest (text)
  - Workspace projects
  - Git dependencies

**Complexity**: **MEDIUM** (2-3 days)
- Text format is straightforward
- Binary format can be stubbed for Phase 2
- Less mature ecosystem = less test data

---

### 1.4 Unified Lockfile Interface

**Files to Modify/Create:**
- `/src/types/lockfile.ts` (extend interface)
- `/src/utils/lockfile.ts` (update)

**Implementation:**

```typescript
// Unified return type from all parsers
export interface ParsedLockfile {
  manager: PackageManager;
  dependencies: Map<string, ResolvedDependency>;
  
  // NEW: Transitive dependency graph
  dependencyGraph?: DependencyGraph;
  
  // NEW: Workspace info for monorepos
  workspaceInfo?: WorkspaceInfo;
  
  // NEW: Parse errors/warnings
  parseWarnings?: string[];
  
  timestamp: number;
}

export interface ResolvedDependency {
  name: string;
  requestedVersion: string;
  resolvedVersion: string;
  integrity?: string;
  
  // NEW: Track dependency source
  dependencies?: Map<string, string>;  // transitive deps
  dev?: boolean;
  optional?: boolean;
  peer?: boolean;
  
  // NEW: For duplicate detection
  isMultipleVersion?: boolean;
  allVersions?: string[];
}

// NEW: Transitive dependency tracking
export interface DependencyGraph {
  [packageName: string]: {
    [version: string]: {
      dependencies: Map<string, string>;
      isDev: boolean;
    };
  };
}

// NEW: Monorepo support
export interface WorkspaceInfo {
  isMonorepo: boolean;
  workspaces: WorkspacePackage[];
}

export interface WorkspacePackage {
  name?: string;
  path: string;
  relativePath: string;
  dependencies: Map<string, ResolvedDependency>;
}
```

---

## Feature 2: Transitive Dependency Scanning (Week 2-3)

### Context
Currently, only direct dependencies (from package.json) are scanned. Transitive dependencies (dependencies of dependencies) can hide vulnerabilities, breaking changes, and version conflicts. This feature adds deep analysis.

### 2.1 Dependency Graph Builder

**Files to Create:**
- `/src/analyzers/dependencyGraph.ts` (new)
- `/src/types/graph.ts` (new)
- `/test/analyzers/dependencyGraph.test.ts` (new)

**Implementation Approach:**

```typescript
export interface DependencyNode {
  name: string;
  version: string;
  requestedRange: string;
  type: 'direct' | 'transitive' | 'peer';
  parent?: DependencyNode;
  children: Map<string, DependencyNode[]>;  // package -> versions
  depth: number;
  isDev: boolean;
  isOptional: boolean;
}

export interface DependencyGraph {
  roots: Map<string, DependencyNode>;
  allNodes: Map<string, DependencyNode[]>;  // flatten for lookup
  cycles: CycleInfo[];
  unresolvedDependencies: UnresolvedDep[];
}

export interface CycleInfo {
  packages: string[];
  cycle: string[];  // e.g., ["a", "b", "c", "a"]
  severity: 'warning' | 'error';
}

export function buildDependencyGraph(
  lockfile: ParsedLockfile,
  packageJson: PackageJsonContent
): DependencyGraph {
  // 1. Create root nodes from direct deps
  // 2. Recursively resolve transitive deps
  // 3. Detect cycles
  // 4. Mark unresolved packages
  // 5. Calculate depth
}

export function analyzeDependencyTree(
  graph: DependencyGraph,
  depth: number = Infinity
): TransitiveDependencyIssue[] {
  // Find problematic transitive deps:
  // - Deprecated packages in tree
  // - Vulnerabilities in tree
  // - Breaking changes in tree
  // - Duplicate versions at different depths
}

export interface TransitiveDependencyIssue {
  package: string;
  version: string;
  issue: 'vulnerability' | 'breaking-change' | 'deprecated' | 'duplicate-version';
  severity: 'critical' | 'high' | 'medium' | 'low';
  path: string[];  // e.g., ["react-native", "@babel/core", "loose-envify"]
  depth: number;
  explanation: string;
}
```

**Algorithm:**

```
function buildGraph(lockfile, packageJson):
  graph = new DependencyGraph()
  visited = Set()
  
  for each dep in packageJson:
    root = createNode(dep.name, dep.version, type='direct')
    graph.roots.add(root)
    resolveTransitive(root, lockfile, visited, graph, depth=0)
  
  detectCycles(graph)
  return graph

function resolveTransitive(node, lockfile, visited, graph, depth):
  if node.id in visited or depth > MAX_DEPTH:
    return
  visited.add(node.id)
  
  resolvedDep = lockfile.get(node.name, node.version)
  if not resolvedDep:
    graph.unresolvedDependencies.add(node)
    return
  
  for each transitiveDep in resolvedDep.dependencies:
    child = createNode(transitiveDep.name, transitiveDep.version)
    node.children.add(child)
    resolveTransitive(child, lockfile, visited, graph, depth+1)
```

**Key Challenges:**
- Cycle detection with version constraints
- Memory usage with deep trees (limit depth)
- Peer dependency resolution (can be multiple valid versions)
- Lockfile may not contain all transitive deps

**Testing Requirements:**
- Test data: Lockfiles with known cycles
- Edge cases:
  - Circular dependencies (A -> B -> A)
  - Deep trees (>10 levels)
  - Peer dependencies with multiple valid versions
  - Missing/unresolved packages
  - Optional dependencies in tree
  - Monorepo workspace cross-references

**Complexity**: **HIGH** (3-4 days)
- Graph algorithms + cycle detection
- Significant test data needed
- Memory profiling for large projects

---

### 2.2 Transitive Vulnerability Scanner

**Files to Create:**
- `/src/analyzers/transitiveVulnerabilities.ts` (new)
- `/test/analyzers/transitiveVulnerabilities.test.ts` (new)

**Implementation:**

```typescript
export interface TransitiveVulnerabilityIssue {
  package: string;
  version: string;
  vulnerability: SecurityVulnerabilityData;
  affectedPaths: string[][];  // multiple paths to this package
  pathCount: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  recommendation: string;
}

export async function findTransitiveVulnerabilities(
  graph: DependencyGraph,
  osvClient: OSVClient
): Promise<TransitiveVulnerabilityIssue[]> {
  // 1. Collect all unique package@version pairs in graph
  // 2. Query OSV for vulnerabilities
  // 3. For each vulnerable package, find all paths to it
  // 4. Determine if it's fixable upstream or requires direct dep update
  // 5. Format recommendations
}

function findAllPaths(
  graph: DependencyGraph,
  targetPackage: string,
  targetVersion: string
): string[][] {
  // Breadth-first search to find all paths from roots to target
}
```

**Complexity**: **MEDIUM** (2-3 days)
- Reuses existing vulnerability analysis
- Path finding is straightforward BFS
- Integration with OSV client

---

## Feature 3: Duplicate & Multiple Version Detection (Week 3-4)

### Context
The current duplicate detection only works with direct dependencies. Projects often have multiple versions of the same package installed at different dependency levels (e.g., react@18 and react@17), causing runtime issues.

### 3.1 Enhanced Duplicate Detection

**Files to Modify/Create:**
- `/src/analyzers/duplicateDependencies.ts` (new, replaces util)
- `/src/utils/versionDetection.ts` (extend)
- `/test/analyzers/duplicateDependencies.test.ts` (new)

**Implementation Approach:**

```typescript
export interface DuplicateDependencyInfo {
  package: string;
  versions: string[];
  
  // NEW: Which packages require this version
  usedBy: Map<string, string[]>;  // { '@babel/core': ['7.0.0'], ... }
  
  // NEW: Conflict analysis
  conflicts: VersionConflict[];
  
  // NEW: Fixing options
  suggestions: DuplicateSuggestion[];
  
  severity: 'critical' | 'high' | 'medium' | 'low';
  affectsRuntime: boolean;
}

export interface VersionConflict {
  version1: string;
  version2: string;
  incompatible: boolean;
  reason: string;
}

export interface DuplicateSuggestion {
  type: 'update-transitive' | 'update-direct' | 'add-resolution' | 'accept-duplicate';
  explanation: string;
  action: string;
  risk: 'low' | 'medium' | 'high';
}

// For react/react-native especially
export function analyzeReactDuplicates(
  graph: DependencyGraph
): ReactiveDuplicateAnalysis {
  // Special handling for React version matrix
  // Check compatibility between multiple React versions
  // Detect if one is dev-only vs production
}

export interface ReactiveDuplicateAnalysis {
  hasMultipleReactVersions: boolean;
  versions: Array<{
    version: string;
    usedBy: string[];
    isDevOnly: boolean;
  }>;
  compatible: boolean;
  riskLevel: 'safe' | 'warning' | 'error';
  explanation: string;
}
```

**Algorithm for Duplicate Detection:**

```
function findDuplicates(graph):
  duplicates = {}
  
  for each node in graph.allNodes:
    package = node.name
    if package not in duplicates:
      duplicates[package] = new DuplicateDependencyInfo()
    
    duplicates[package].versions.add(node.version)
    duplicates[package].usedBy[node.parent.name] = node.version
  
  // Filter to only actual duplicates
  return filter(duplicates, lambda x: len(x.versions) > 1)
```

**Special Case: React/React Native**

```
function isReactNativeDuplicate(dupInfo):
  if dupInfo.package in ['react', 'react-native']:
    // Check if versions are compatible
    versions = sorted(dupInfo.versions, reverse=True)
    
    // e.g., react 18.2 + react 16.8 = error
    // but react 18.0 + react 18.2 = warning (can patch)
    
    if canAutoResolve(versions):
      severity = 'high'
    else:
      severity = 'critical'
```

**Testing Requirements:**
- Real projects with react version duplication
- Monorepos with different RN versions per workspace
- Peer dependency conflicts triggering duplicates
- Transitive deps pulling in old versions

**Complexity**: **MEDIUM** (2-3 days)
- Logic builds on existing detection
- React compatibility matrix requires data
- Suggestions require domain knowledge

---

### 3.2 React/React Native Compatibility Matrix

**Files to Create:**
- `/src/data/reactCompatibility.ts` (new)
- `/test/data/reactCompatibility.test.ts` (new)

**Implementation:**

```typescript
export interface ReactNativeCompatibilityEntry {
  reactNativeVersion: string;
  reactVersions: string[];  // compatible versions
  nodeVersions: string[];
  hermes: boolean;
  newArch: boolean;
  notes?: string[];
}

export const reactNativeCompatibilityMatrix: ReactNativeCompatibilityEntry[] = [
  {
    reactNativeVersion: '0.75.0',
    reactVersions: ['^18.2.0', '^19.0.0-beta'],
    nodeVersions: ['18.x', '20.x'],
    hermes: true,
    newArch: true,
  },
  {
    reactNativeVersion: '0.74.0',
    reactVersions: ['^18.2.0'],
    nodeVersions: ['18.x', '20.x'],
    hermes: true,
    newArch: true,
  },
  {
    reactNativeVersion: '0.73.0',
    reactVersions: ['^18.0.0'],
    nodeVersions: ['18.x'],
    hermes: true,
    newArch: false,
  },
  // ... more entries
];

export function getCompatibleReactVersions(
  rnVersion: string
): string[] {
  const entry = reactNativeCompatibilityMatrix.find(
    e => versionInRange(rnVersion, e.reactNativeVersion)
  );
  return entry?.reactVersions || [];
}
```

**Complexity**: **LOW** (1 day)
- Data collection from React Native docs
- Simple lookup function

---

## Feature 4: Enhanced Breaking Change Database (Week 4-5)

### Context
Current database has ~10 entries. Production projects need 50+ packages covered with real-world breaking changes, migration guides, and impact analysis.

### 4.1 Breaking Change Database Expansion

**Files to Modify/Create:**
- `/src/data/breakingChanges.ts` (expand)
- `/src/data/breakingChangesRegistry.ts` (new - helper to manage 50+ entries)
- `/test/data/breakingChanges.test.ts` (extend)

**Target Packages (Priority Order):**

**Tier 1 (CRITICAL - 15 packages):**
- react-native (all major versions)
- react (16->17, 17->18 transitions)
- @react-navigation/* (6->7 major jump)
- react-native-reanimated
- react-native-screens
- react-native-gesture-handler
- metro-resolver
- @react-native-community/hooks
- react-native-fast-image
- redux (3->4, 4->5 gaps)
- react-redux (7->8)
- typescript (4->5)
- expo (47-51)
- babel (7.x minor to minor)
- jest (27->28->29)

**Tier 2 (HIGH - 20 packages):**
- axios (0.x->1.x)
- lodash (4.x stability tracking)
- date-fns (2.x minor updates)
- react-query -> @tanstack/react-query
- react-hook-form (6->7)
- zustand (4.x)
- mobx (5->6)
- immer (8->9->10)
- ramda (0.x)
- graphql (14->15->16)
- apollo-client (3.x minor)
- styled-components (5->6)
- react-native-svg
- react-native-vector-icons
- react-native-safe-area-context
- react-native-share
- @testing-library/react-native
- jest-mock-extended
- async-storage
- keychain

**Tier 3 (MEDIUM - 20 packages):**
- Smaller but commonly-used packages
- Android-specific: react-native-keychain, react-native-permissions
- Navigation: react-native-tab-navigator
- UI: NativeBase, react-native-elements
- Storage: realm, sqlite3
- Analytics: @react-native-firebase/*

**Breaking Change Template:**

```typescript
{
  package: 'react-native',
  introducedInVersion: '0.75.0',
  affectedVersions: ['>=0.75.0'],
  severity: 'high',
  category: 'api',  // 'api' | 'behavior' | 'dependency' | 'platform' | 'performance'
  
  changes: [
    'Removed ViewPropTypes deprecation warning suppression',
    'Bridging module linking requires new configuration',
    'useWindowDimensions now returns values in DP instead of PX on Android',
  ],
  
  impactAnalysis: {
    affectsAndroid: true,
    affectsIOS: true,
    affectsExpo: false,
    affectsNewArch: true,
    affectsPeerDependencies: ['react@18+'],
  },
  
  migrationGuide: `
    ## Migration Guide for react-native@0.75
    
    ### 1. ViewPropTypes Changes
    If you see warnings about ViewPropTypes:
    - Update usages to use 'react-native/Libraries/Components/View/ViewPropTypes'
    - Or suppress via react-native.config.js
    
    ### 2. Bridging Configuration
    Update your native module linking...
    [detailed steps with code examples]
    
    ### 3. useWindowDimensions on Android
    ...
  `,
  
  references: [
    {
      type: 'CHANGELOG',
      url: 'https://github.com/facebook/react-native/releases/tag/v0.75.0',
      title: 'React Native v0.75.0 Release Notes'
    },
    {
      type: 'MIGRATION_GUIDE',
      url: 'https://reactnative.dev/docs/upgrading',
      title: 'Official Upgrade Guide'
    },
    {
      type: 'ISSUE',
      url: 'https://github.com/facebook/react-native/issues/xxxxx',
      title: 'Discussion: ViewPropTypes deprecation'
    }
  ],
  
  autoDetectable: true,  // Can detection be fully automated or requires manual check
  commonWorkarounds: [
    {
      workaround: 'Use conditional require',
      code: `const ViewPropTypes = require('react-native/Libraries/Components/View/ViewPropTypes');`,
      risk: 'low'
    }
  ]
}
```

**Data Source Strategy:**
1. Parse GitHub CHANGELOG files for target repos
2. Manual review of release notes for Tier 1 packages
3. Community input: scan popular GitHub issues labeled "breaking-change"
4. Version diff analysis: semantic version increases often correlate with breaks

**Implementation Structure:**

```typescript
// /src/data/breakingChanges.ts - organized by severity
const CRITICAL_BREAKING_CHANGES: BreakingChange[] = [ /* 15 entries */ ];
const HIGH_PRIORITY_BREAKING_CHANGES: BreakingChange[] = [ /* 20 entries */ ];
const MEDIUM_PRIORITY_BREAKING_CHANGES: BreakingChange[] = [ /* 20 entries */ ];

export const breakingChangeDatabase: BreakingChange[] = [
  ...CRITICAL_BREAKING_CHANGES,
  ...HIGH_PRIORITY_BREAKING_CHANGES,
  ...MEDIUM_PRIORITY_BREAKING_CHANGES,
];

// Helper functions
export function getBreakingChangesForPackage(packageName: string): BreakingChange[] {
  return breakingChangeDatabase.filter(bc => bc.package === packageName);
}

export function searchBreakingChanges(query: string): BreakingChange[] {
  // Full-text search in changes array and migration guides
}

export function getBreakingChangesCoveringVersionRange(
  packageName: string,
  fromVersion: string,
  toVersion: string
): BreakingChange[] {
  // Find all breaking changes between two versions
}
```

**Validation:**

```typescript
// /test/data/breakingChanges.test.ts

test('all packages in database have real versions', () => {
  // Validate that introducedInVersion is valid semver
});

test('affected versions cover introduced version', () => {
  // Ensure affectedVersions always includes introducedInVersion
});

test('references are valid URLs', () => {
  // HTTP check or at least format validation
});

test('migration guides are not empty', () => {
  // Critical breaking changes must have guides
});

test('no duplicate entries', () => {
  // packageName + introducedInVersion must be unique
});
```

**Complexity**: **HIGH** (4-5 days)
- Data collection time (research, validation)
- Writing quality migration guides
- Testing with real version scenarios

---

### 4.2 Breaking Change Analyzer Enhancement

**Files to Modify/Create:**
- `/src/analyzers/breakingChanges.ts` (enhance existing)
- `/src/utils/breakingChangeSearch.ts` (new helper)

**Enhancements:**

```typescript
export interface EnhancedBreakingChangeResult {
  package: string;
  currentVersion: string;
  hasBreakingChanges: boolean;
  
  // NEW: Path from current to latest
  upgradeImpact?: BreakingChangePath[];
  
  // NEW: If upgrading to latest, what breaks?
  breakingChangesInUpgradePath: BreakingChangeIssue[];
  
  // NEW: If upgrading to next minor, any breaks?
  minorUpgradeBreaks: BreakingChangeIssue[];
  
  // NEW: Estimated migration effort
  estimatedEffort: 'low' | 'medium' | 'high' | 'very-high';
  
  // NEW: Can upgrade gradually or must be all-at-once?
  canGraduallyUpgrade: boolean;
  
  // NEW: Recommended upgrade path
  recommendedUpgradePath: VersionStep[];
}

export interface VersionStep {
  fromVersion: string;
  toVersion: string;
  breakingChanges: BreakingChangeIssue[];
  estimatedEffort: 'low' | 'medium' | 'high';
  reasonToStop: string | null;  // If null, can continue; otherwise why to pause here
}

export function analyzeUpgradePath(
  packageName: string,
  currentVersion: string,
  targetVersion: string
): BreakingChangePath[] {
  // Trace from currentVersion to targetVersion
  // Identify all breaking changes along the way
  // Suggest logical stopping points (e.g., major version boundaries)
}
```

**Complexity**: **MEDIUM** (2-3 days)
- Builds on existing analyzer
- Version path analysis is algorithmic
- Data-driven by enhanced database

---

## Feature 5: Improved Error Handling & Messages (Week 5-6)

### Context
Current errors are generic. Production users need contextual, actionable error messages that explain:
1. What went wrong
2. Why it matters
3. How to fix it
4. What to do if unfixable

### 5.1 Error Classification System

**Files to Create:**
- `/src/errors/ScannerError.ts` (new)
- `/src/errors/errorHandling.ts` (new)
- `/src/errors/errorMessages.ts` (new)
- `/test/errors/errorHandling.test.ts` (new)

**Implementation:**

```typescript
// /src/errors/ScannerError.ts
export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  FATAL = 'fatal',
}

export enum ErrorCategory {
  // File I/O
  PACKAGE_JSON_NOT_FOUND = 'PACKAGE_JSON_NOT_FOUND',
  LOCKFILE_NOT_FOUND = 'LOCKFILE_NOT_FOUND',
  LOCKFILE_PARSE_ERROR = 'LOCKFILE_PARSE_ERROR',
  UNREADABLE_FILE = 'UNREADABLE_FILE',
  
  // Network
  OSV_API_UNREACHABLE = 'OSV_API_UNREACHABLE',
  OSV_RATE_LIMITED = 'OSV_RATE_LIMITED',
  REGISTRY_UNREACHABLE = 'REGISTRY_UNREACHABLE',
  
  // Data
  INVALID_VERSION_SPEC = 'INVALID_VERSION_SPEC',
  DEPENDENCY_NOT_RESOLVED = 'DEPENDENCY_NOT_RESOLVED',
  INTEGRITY_MISMATCH = 'INTEGRITY_MISMATCH',
  
  // Analysis
  CIRCULAR_DEPENDENCY = 'CIRCULAR_DEPENDENCY',
  UNMET_PEER_DEPENDENCY = 'UNMET_PEER_DEPENDENCY',
  INCOMPATIBLE_VERSIONS = 'INCOMPATIBLE_VERSIONS',
  
  // Configuration
  INVALID_NODE_VERSION = 'INVALID_NODE_VERSION',
  UNSUPPORTED_PACKAGE_MANAGER = 'UNSUPPORTED_PACKAGE_MANAGER',
}

export class ScannerError extends Error {
  code: ErrorCategory;
  severity: ErrorSeverity;
  context?: Record<string, unknown>;
  suggestion?: string;
  affectedPackages?: string[];
  
  constructor(
    code: ErrorCategory,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.code = code;
    this.severity = this.categorizeError(code);
    this.context = context;
  }
  
  private categorizeError(code: ErrorCategory): ErrorSeverity {
    // Map codes to severity
  }
  
  withSuggestion(suggestion: string): this {
    this.suggestion = suggestion;
    return this;
  }
  
  withAffectedPackages(...packages: string[]): this {
    this.affectedPackages = packages;
    return this;
  }
  
  toJSON() {
    return {
      code: this.code,
      severity: this.severity,
      message: this.message,
      suggestion: this.suggestion,
      context: this.context,
      affectedPackages: this.affectedPackages,
    };
  }
}

// /src/errors/errorMessages.ts
export const ERROR_MESSAGES: Record<ErrorCategory, ErrorMessageTemplate> = {
  [ErrorCategory.PACKAGE_JSON_NOT_FOUND]: {
    message: 'package.json not found',
    template: `
      Cannot find package.json in {{ path }}.
      
      Make sure you're running rn-dep-scanner from the root of your React Native project.
      
      Try:
        cd /path/to/your/project
        rn-dep-scanner check
    `,
    severity: ErrorSeverity.FATAL,
  },
  
  [ErrorCategory.LOCKFILE_PARSE_ERROR]: {
    message: 'Failed to parse lockfile',
    template: `
      Error parsing {{ lockfileType }}: {{ error }}
      
      This usually means:
      1. Lockfile is corrupted (try running 'npm install' again)
      2. Lockfile format version is not supported (upgrade rn-dep-scanner)
      3. Lockfile is incomplete (deleted during installation)
      
      Fix:
        - Backup your package.json
        - Delete node_modules and lockfile
        - Run: npm install
        - Re-run: rn-dep-scanner check
    `,
    severity: ErrorSeverity.ERROR,
  },
  
  [ErrorCategory.CIRCULAR_DEPENDENCY]: {
    message: 'Circular dependency detected',
    template: `
      Circular dependency found: {{ cycle }}
      
      This creates a dependency loop that may cause:
      - Module resolution failures
      - Unexpected runtime behavior
      - Installation issues
      
      Packages involved:
      {{ packages }}
      
      Suggested fix:
        1. Check if all packages are really needed
        2. Consider moving common dependencies to root
        3. Review your monorepo structure
    `,
    severity: ErrorSeverity.WARNING,
  },
};
```

**Complexity**: **MEDIUM** (2-3 days)
- System design is straightforward
- Message writing is time-consuming
- Template system requires testing

---

### 5.2 Error Recovery & Fallback Modes

**Implementation:**

```typescript
export class ScannerWithFallbacks {
  async checkWithFallbacks(options: CheckOptions) {
    try {
      // Primary mode: full analysis
      return await this.fullCheck(options);
    } catch (error) {
      if (error instanceof ScannerError) {
        switch (error.code) {
          case ErrorCategory.LOCKFILE_PARSE_ERROR:
            // Fallback: analyze package.json only (no resolved versions)
            return this.degradedCheck_NoLockfile(options, error);
          
          case ErrorCategory.OSV_API_UNREACHABLE:
            // Fallback: use cached/local vulnerability data
            return this.degradedCheck_OfflineMode(options, error);
          
          case ErrorCategory.INVALID_VERSION_SPEC:
            // Skip problematic packages, continue analysis
            return this.degradedCheck_SkipInvalid(options, error);
          
          default:
            // Unknown error: at least read package.json
            return this.minimalCheck(options, error);
        }
      }
      throw error;
    }
  }
  
  private degradedCheck_NoLockfile(
    options: CheckOptions,
    originalError: ScannerError
  ) {
    // Analysis without resolved versions
    // - Show declared versions only
    // - Skip transitive scanning
    // - Show this limitation in output
    // - Suggest running 'npm install'
  }
  
  private degradedCheck_OfflineMode(
    options: CheckOptions,
    originalError: ScannerError
  ) {
    // Use cached vulnerability data from last 24 hours
    // Warn that data may be stale
    // Continue with all other analysis
  }
}
```

**Complexity**: **LOW** (1-2 days)
- Straightforward defensive programming
- Reuses existing analysis functions

---

## Feature 6: Implementation Infrastructure (Week 5)

### 6.1 Test Infrastructure Enhancement

**Files to Create:**
- `/test/fixtures/lockfiles/` (new)
  - `npm-lockfile-v3.json`
  - `yarn-lock-v2.yaml`
  - `pnpm-lock-v9.yaml`
  - `bun-lock-v6.txt`
  - Complex monorepo examples
  - Edge cases (circular deps, cycles, etc.)
  
- `/test/fixtures/graphs/` (new)
  - Pre-built dependency graphs
  - Known cycles
  - Version conflicts
  
- `/test/helpers/fixtures.ts` (new)
  - Utility functions to load test data
  - Create mock lockfiles
  - Generate test dependency graphs

**Implementation:**

```typescript
// /test/helpers/fixtures.ts
export class TestFixtures {
  static loadLockfile(manager: PackageManager, name: string): string {
    // Load from fixtures directory
  }
  
  static createMockPackageJson(deps: Record<string, string>): PackageJsonContent {
    // Utility to quickly create test package.json
  }
  
  static createMockLockfile(
    manager: PackageManager,
    deps: Record<string, string>,
    transitive?: Record<string, Record<string, string>>
  ): ParsedLockfile {
    // Generate mock lockfile for testing
  }
  
  static createDependencyGraph(
    structure: GraphDefinition
  ): DependencyGraph {
    // Define: { "react": "^18.0.0 -> react-dom", ... }
    // Returns built graph
  }
}
```

**Test Targets:**
- Each parser: 15-20 tests per format
- Dependency graph: 20-25 tests
- Transitive analysis: 15-20 tests
- Breaking changes: 30-40 tests (one per major package/version combo)
- Error handling: 20-25 tests

**Total New Tests**: ~150-200

**Complexity**: **HIGH** (3-4 days)
- Significant test data creation
- Fixture infrastructure setup
- Validation of each test case

---

### 6.2 Documentation Updates

**Files to Create/Modify:**
- `/docs/ARCHITECTURE.md` (new) - Phase 2 architecture
- `/docs/LOCKFILE_FORMATS.md` (new) - Parser specifications
- `/docs/BREAKING_CHANGES_DATABASE.md` (new) - How to add entries
- `/docs/EXTENDING.md` (new) - How to add new analyzers
- `/PHASE_2_ROADMAP.md` (this file)
- `/README.md` (update with Phase 2 features)

**Complexity**: **LOW** (1-2 days)
- Documentation can be written incrementally
- Code examples from implementation

---

## Implementation Timeline & Dependencies

### Week-by-Week Breakdown

```
Week 1-2: Lockfile Parsing
  ├─ Yarn parser (5 days)
  ├─ pnpm parser (4 days)
  ├─ Bun parser (2 days)
  └─ Unified interface (1 day)
  Total: ~2 weeks
  Dependencies: None
  Blockers: Test data collection

Week 2-3: Transitive Scanning (parallel with Lockfile)
  ├─ Dependency graph builder (3 days)
  ├─ Transitive vulnerability scanner (3 days)
  └─ Integration tests (3 days)
  Total: ~2 weeks
  Dependencies: Week 1 lockfile parsing
  Blockers: Complex cycle detection

Week 3-4: Duplicate Detection (parallel with Transitive)
  ├─ Enhanced duplicate detection (3 days)
  ├─ React/RN compatibility matrix (1 day)
  └─ Integration tests (2 days)
  Total: ~1 week
  Dependencies: Week 1 lockfile parsing
  Blockers: None

Week 4-5: Breaking Changes Database
  ├─ Database expansion to 50+ packages (4 days)
  ├─ Breaking change analyzer enhancement (3 days)
  └─ Tests & validation (2 days)
  Total: ~2 weeks
  Dependencies: Week 2-3 graph building
  Blockers: Data collection & research

Week 5-6: Error Handling & Polish
  ├─ Error classification system (2 days)
  ├─ Fallback mechanisms (2 days)
  ├─ Error messages database (1 day)
  └─ Integration testing (1 day)
  Total: ~1 week
  Dependencies: Previous features for context
  Blockers: None

Week 5: Infrastructure & Testing
  ├─ Test fixtures & helpers (2 days)
  ├─ Test suite for all features (2 days)
  └─ Documentation (1 day)
  Total: ~1 week
  Dependencies: All features
  Blockers: None

TOTAL: ~6-8 weeks
```

### Dependency Graph

```
Lockfile Parsing (Week 1-2)
        ↓
        ├─→ Transitive Scanning (Week 2-3)
        │        ├─→ Transitive Vulnerabilities
        │        └─→ Breaking Changes in Tree
        │
        ├─→ Duplicate Detection (Week 3-4)
        │        ├─→ React Compatibility Matrix
        │        └─→ Version Conflict Analysis
        │
        └─→ Breaking Changes DB (Week 4-5)
                 ├─→ Enhanced Analyzer
                 └─→ Upgrade Path Analysis

All Features → Error Handling (Week 5-6)
             → Testing & Documentation (Week 5)
             → Release v2.0.0
```

---

## File Structure Summary

### New Files to Create (16 total)

**Parsers:**
- `/src/parsers/yarnLockParser.ts` (rewrite existing)
- `/src/parsers/pnpmLockParser.ts` (rewrite existing)
- `/src/parsers/bunLockParser.ts` (rewrite existing)

**Analysis:**
- `/src/analyzers/dependencyGraph.ts`
- `/src/analyzers/duplicateDependencies.ts`
- `/src/analyzers/transitiveVulnerabilities.ts`
- `/src/utils/breakingChangeSearch.ts`

**Data:**
- `/src/data/reactCompatibility.ts`
- `/src/data/breakingChangesRegistry.ts`

**Errors:**
- `/src/errors/ScannerError.ts`
- `/src/errors/errorHandling.ts`
- `/src/errors/errorMessages.ts`

**Tests:**
- `/test/parsers/yarnLockParser.test.ts`
- `/test/parsers/pnpmLockParser.test.ts`
- `/test/parsers/bunLockParser.test.ts`
- `/test/analyzers/dependencyGraph.test.ts`
- `/test/analyzers/duplicateDependencies.test.ts`
- `/test/analyzers/transitiveVulnerabilities.test.ts`
- `/test/errors/errorHandling.test.ts`

**Types & Helpers:**
- `/src/types/graph.ts`
- `/test/helpers/fixtures.ts`

**Documentation:**
- `/docs/ARCHITECTURE.md`
- `/docs/LOCKFILE_FORMATS.md`
- `/docs/BREAKING_CHANGES_DATABASE.md`
- `/docs/EXTENDING.md`

### Files to Modify (8 total)

- `/src/types/lockfile.ts` (extend interfaces)
- `/src/types/dependency.ts` (extend interfaces)
- `/src/utils/lockfile.ts` (update to use all parsers)
- `/src/analyzers/breakingChanges.ts` (enhance)
- `/src/commands/check.ts` (integrate transitive analysis)
- `/src/utils/terminal.ts` (new output sections)
- `/src/data/breakingChanges.ts` (expand database)
- `/README.md` (update docs)
- `/package.json` (update version)

---

## Success Criteria

### Phase 2 Definition of Done

✅ **Functionality**
- [ ] All four lockfile formats parse correctly on real projects
- [ ] Transitive dependencies discovered up to 10 levels deep
- [ ] Circular dependencies detected and reported
- [ ] Duplicate packages identified with version specificity
- [ ] Breaking changes database covers 50+ packages
- [ ] Breaking change analyzer shows upgrade paths
- [ ] Error messages are contextual and actionable
- [ ] Fallback modes work when primary sources unavailable

✅ **Test Coverage**
- [ ] 150+ new test cases added
- [ ] 95%+ code coverage on new code
- [ ] All edge cases covered (cycles, monorepos, etc.)
- [ ] Real lockfile format tests pass

✅ **Performance**
- [ ] Analysis completes <5 seconds for medium projects (500 deps)
- [ ] Transitive scanning with depth limit doesn't cause OOM
- [ ] Memory footprint <100MB for large projects

✅ **Documentation**
- [ ] Architecture document explains Phase 2 changes
- [ ] Each new feature has a README section
- [ ] Breaking changes database documented with addition guide
- [ ] All public APIs have JSDoc comments

✅ **Quality**
- [ ] TypeScript strict mode passes
- [ ] No npm audit vulnerabilities
- [ ] Package size <30KB (gzipped)
- [ ] All CLI commands work without errors

---

## Migration Guide for Users

### Upgrading from v1.x to v2.0

**Breaking Changes:**
- Output format slightly different (new sections for transitive issues)
- JSON output adds new fields
- Node.js 18+ required (was 16+ before)

**New Capabilities:**
```bash
# Same commands work, with enhanced output
npm run dev check

# Now shows:
# - Transitive vulnerabilities in dependencies
# - Duplicate package versions across tree
# - Breaking changes in indirect dependencies
# - Enhanced error messages
```

---

## Known Limitations & Future Work

### Phase 2 Limitations
- Bun binary lockfile format not supported (text only)
- Depth limit on transitive analysis (set to 10 by default)
- Peer dependency hoisting not fully modeled
- Platform-specific analysis (New Arch, Hermes) deferred to Phase 3

### Phase 3+ Roadmap
- New Architecture / Hermes detection
- Monorepo workspace integration
- CI/CD pipeline plugins
- Automated upgrade suggestions
- Real-time vulnerability feed
- Package provenance checking

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Lockfile parser bugs | HIGH | Extensive test fixtures, real-world validation |
| Circular dependency performance | MEDIUM | Depth limiting, cycle detection early |
| OSV API rate limits | MEDIUM | Caching, batch requests, fallback mode |
| Breaking change database accuracy | HIGH | Community review, multiple sources |
| Memory usage with deep graphs | MEDIUM | Lazy loading, streaming results |
| Monorepo complexity | HIGH | Start with simple monorepos, iterative |

---

## Review Checklist (Before Release)

- [ ] All parsers tested with real lockfiles
- [ ] GitHub Actions tests pass (CI/CD)
- [ ] Manual testing on 3-5 real projects
- [ ] Breaking change database reviewed by community
- [ ] Performance benchmarks documented
- [ ] Error messages tested with actual error scenarios
- [ ] README updated with Phase 2 features
- [ ] Version bumped to v2.0.0
- [ ] CHANGELOG.md updated
- [ ] npm package publishes without warnings

---

## Appendix: Reference Materials

### Lockfile Format Specifications
- npm: https://docs.npmjs.com/cli/v9/configuring-npm/package-lock-json
- Yarn Classic: https://classic.yarnpkg.com/docs/lockfile/
- Yarn Modern: https://yarnpkg.com/getting-started/install
- pnpm: https://pnpm.io/lockfile
- Bun: https://bun.sh/docs/install/lockfile

### Compatibility Resources
- React Native Releases: https://github.com/facebook/react-native/releases
- React Compatibility: https://react.dev/
- Breaking Changes Registry: https://openrewrite.org/docs/recipes/
- OSV Database: https://osv.dev/

### Testing Data Sources
- Real projects on GitHub (for test fixtures)
- npm Registry (version history)
- OSV.dev (vulnerability test data)

---

**Last Updated**: 2026-08-31  
**Author**: Claude Code Agent  
**Status**: Ready for implementation sprint
