# Phase 2 Implementation Checklist

This document provides a detailed, executable checklist for implementing Phase 2 features in sequence.

---

## Pre-Implementation Setup

### Environment & Dependencies
- [ ] Node.js 18+ verified (`node --version`)
- [ ] npm 9+ verified (`npm --version`)
- [ ] TypeScript compiler verified (`npx tsc --version`)
- [ ] All existing tests passing (`npm run test`)
- [ ] Project compiles without errors (`npm run build`)
- [ ] Review CLAUDE.md architecture overview
- [ ] Create feature branch: `git checkout -b phase-2/lockfile-parsing`

### Documentation
- [ ] Read Phase 2 roadmap in PHASE_2_ROADMAP.md
- [ ] Review existing Phase 1 implementation in src/
- [ ] Understand current lockfile.ts and parsers structure
- [ ] Document any discoveries in implementation notes

---

## Sprint 1: Lockfile Parsing Foundation (Week 1-2)

### 1.1 Yarn Lockfile Parser

#### Setup
- [ ] Create `/src/parsers/yarnLockParser.ts` as new implementation
- [ ] Extend `/src/types/lockfile.ts` with YarnLockEntry, YarnWorkspaceInfo types
- [ ] Verify existing structure (map of package names to versions)

#### Yarn v1 Parser Implementation
- [ ] Implement `parseYarnV1()` function:
  - [ ] Split content by `\n\n` (entry separator)
  - [ ] Extract package header: `package@version:` or `"package@version":`
  - [ ] Parse scoped packages: `@scope/package@range`
  - [ ] Parse indented properties:
    - [ ] `version "x.y.z"`
    - [ ] `resolved "https://..."`
    - [ ] `integrity "sha512-..."`
    - [ ] `dependencies { package: "version", ... }`
  - [ ] Return ResolvedDependency map
- [ ] Add edge case handling:
  - [ ] Ignore comments (lines starting with `#`)
  - [ ] Handle missing optional fields
  - [ ] Trim whitespace properly

#### Yarn v2+ Parser Implementation
- [ ] Implement `parseYarnV2Plus()` function:
  - [ ] Parse YAML structure (use simple YAML parser or regex)
  - [ ] Extract `__metadata` block
  - [ ] Parse package entries with nested references
  - [ ] Handle workspace paths
  - [ ] Resolve package references
- [ ] Add workspace detection:
  - [ ] Check for `workspaces` field
  - [ ] Parse workspace glob patterns
  - [ ] Map workspace packages

#### Format Detection
- [ ] Implement `detectYarnVersion()`:
  - [ ] Check first 100 lines for `# yarn lockfile v2` or `# yarn lockfile v3`
  - [ ] Check for `__metadata` entries
  - [ ] Default to v1 if unclear
  - [ ] Return detected version

#### Testing: Yarn v1
- [ ] Create `/test/parsers/yarnLockParser.test.ts`
- [ ] Test basic package parsing:
  - [ ] `react@^18.0.0` -> version, resolved, integrity
  - [ ] `@babel/core@^7.0.0` (scoped package)
  - [ ] Optional/dev dependency flags
- [ ] Test transitive dependencies:
  - [ ] Package with dependencies block
  - [ ] Multiple transitive levels
- [ ] Test edge cases:
  - [ ] Missing optional fields
  - [ ] Comments in file
  - [ ] Empty dependencies block
  - [ ] Circular references

#### Testing: Yarn v2+
- [ ] Test v2 YAML format:
  - [ ] Workspace detection
  - [ ] Package resolution
  - [ ] Metadata parsing
- [ ] Compare v1 vs v2 output:
  - [ ] Same packages detected
  - [ ] Same versions resolved

#### Real Lockfile Testing
- [ ] Collect real yarn.lock files:
  - [ ] From popular React Native project
  - [ ] Include v1, v2, v3 examples
- [ ] Validate parser against real files:
  - [ ] npm audit shows no unexpected packages
  - [ ] Known packages present and correct versions
  - [ ] Counts match visual inspection

#### Integration
- [ ] Update `/src/utils/lockfile.ts`:
  - [ ] Import new parseYarnLock function
  - [ ] Add to parseLockfile() switch
- [ ] Update `/src/types/lockfile.ts` if needed

---

### 1.2 pnpm Lockfile Parser

#### Setup
- [ ] Create `/src/parsers/pnpmLockParser.ts` as new implementation
- [ ] Extend `/src/types/lockfile.ts` with pnpm-specific types
- [ ] Gather pnpm-lock.yaml specification docs

#### YAML Parsing Foundation
- [ ] Implement basic YAML parsing (or use lightweight parser):
  - [ ] Parse key-value pairs at root level
  - [ ] Parse nested objects with indentation
  - [ ] Handle string values with quotes
  - [ ] Ignore comments

#### Direct Dependencies
- [ ] Parse `dependencies:` section:
  - [ ] Extract package name and requested version
  - [ ] Handle scoped packages
  - [ ] Store as root-level dependencies

#### Resolved Packages
- [ ] Parse `packages:` section:
  - [ ] Extract package key: `package@version`
  - [ ] Parse package object:
    - [ ] `version: "x.y.z"`
    - [ ] `resolved: "https://..."`
    - [ ] `integrity: "sha512-..."`
    - [ ] `dependencies: { package: version, ... }`
  - [ ] Handle pnpm's package format

#### Monorepo Support
- [ ] Detect monorepo structure:
  - [ ] Check for `importers:` section
  - [ ] Parse workspace paths
  - [ ] Extract each workspace's dependencies
- [ ] Handle hoisting:
  - [ ] Understand pnpm's strict/hoisting modes
  - [ ] Map which versions are hoisted to root

#### Lockfile Version Compatibility
- [ ] Support pnpm lockfile versions 5.1-latest
- [ ] Extract `lockfileVersion` field
- [ ] Document format differences per version

#### Testing: Basic Structure
- [ ] Create `/test/parsers/pnpmLockParser.test.ts`
- [ ] Test simple lockfile:
  - [ ] Single dependency
  - [ ] Transitive dependencies
  - [ ] Version resolution
- [ ] Test monorepo structure:
  - [ ] Multiple workspace packages
  - [ ] Cross-workspace dependencies
- [ ] Test edge cases:
  - [ ] Missing optional fields
  - [ ] Different lockfile versions
  - [ ] Hoisted vs non-hoisted packages

#### Real Lockfile Testing
- [ ] Collect real pnpm-lock.yaml files
- [ ] Test on monorepo examples
- [ ] Validate version resolution

#### Integration
- [ ] Update `/src/utils/lockfile.ts`
- [ ] Add to parseLockfile() switch

---

### 1.3 Bun Lockfile Parser

#### Setup
- [ ] Create `/src/parsers/bunLockParser.ts` implementation
- [ ] Extend `/src/types/lockfile.ts` with Bun types
- [ ] Research Bun lockfile format stability

#### Binary Format Handling
- [ ] Implement `isBunBinaryFormat()`:
  - [ ] Check for magic bytes at file start
  - [ ] Detect Bun lockfile version
- [ ] Stub binary parser:
  - [ ] For Phase 2: return graceful error or empty map
  - [ ] Log message to user: "Binary Bun lockfiles not yet supported, using package.json only"

#### Text Format Parser
- [ ] Implement `parseBunTextFormat()`:
  - [ ] Parse header: `# bun.lock v{version}`
  - [ ] Extract package entries (similar to Yarn v1)
  - [ ] Parse version, resolved, integrity
  - [ ] Parse dependencies block
  - [ ] Handle optional/dev flags

#### Bun-Specific Features
- [ ] Handle Bun-specific dependency types:
  - [ ] Git dependencies
  - [ ] File dependencies
  - [ ] Workspace dependencies

#### Testing
- [ ] Create `/test/parsers/bunLockParser.test.ts`
- [ ] Test text format parsing
- [ ] Test binary format detection/fallback
- [ ] Test edge cases

#### Real Lockfile Testing
- [ ] Collect real bun.lock files if available
- [ ] Test on Bun projects

#### Integration
- [ ] Update `/src/utils/lockfile.ts`
- [ ] Add to parseLockfile() switch

---

### 1.4 Unified Lockfile Interface

#### Type Definitions
- [ ] Review and extend `/src/types/lockfile.ts`:
  - [ ] Add DependencyGraph interface
  - [ ] Add WorkspaceInfo interface
  - [ ] Add parseWarnings field to ParsedLockfile
  - [ ] Update ResolvedDependency with transitive deps
- [ ] Ensure backward compatibility with existing code

#### Lockfile Utilities
- [ ] Update `/src/utils/lockfile.ts`:
  - [ ] Import all parser functions
  - [ ] Update parseLockfile() to route to all parsers
  - [ ] Add manager detection (already exists)
  - [ ] Add parse error handling
  - [ ] Document format detection logic

#### Error Handling
- [ ] Add try-catch blocks:
  - [ ] Catch parser errors and return empty map with warnings
  - [ ] Log parse errors for debugging
  - [ ] Ensure graceful degradation

#### Validation
- [ ] Add ParsedLockfile validation:
  - [ ] Check dependencies map is not null
  - [ ] Validate package names and versions
  - [ ] Check for obvious duplicates in same format

#### Testing: Integration
- [ ] Create test file: `/test/parsers/lockfileIntegration.test.ts`
- [ ] Test manager detection:
  - [ ] Correct parser chosen per lockfile type
  - [ ] Falls back to npm on missing lockfile
- [ ] Test unified output:
  - [ ] Same output structure from all parsers
  - [ ] Dependencies map compatible across formats
- [ ] Test error scenarios:
  - [ ] Corrupt lockfile
  - [ ] Missing lockfile
  - [ ] Unsupported format version

#### Documentation
- [ ] Add comments to lockfile.ts explaining format differences
- [ ] Document parser outputs in ARCHITECTURE.md
- [ ] Create LOCKFILE_FORMATS.md with format specifications

#### Review & Commit
- [ ] All Yarn, pnpm, Bun tests passing
- [ ] npm audit clean
- [ ] TypeScript strict mode: no errors
- [ ] Code review checklist:
  - [ ] No console.log statements (except for debugging stubs)
  - [ ] Proper error messages
  - [ ] Type safety throughout
- [ ] Commit: `git commit -m "feat: implement yarn, pnpm, bun lockfile parsers"`

---

## Sprint 2: Transitive Dependency Scanning (Week 2-3)

### 2.1 Dependency Graph Builder

#### Type Definitions
- [ ] Create `/src/types/graph.ts`:
  - [ ] DependencyNode interface
  - [ ] DependencyGraph interface
  - [ ] CycleInfo interface
  - [ ] UnresolvedDep interface

#### Graph Construction Algorithm
- [ ] Create `/src/analyzers/dependencyGraph.ts`
- [ ] Implement `buildDependencyGraph()`:
  - [ ] Initialize root nodes from package.json
  - [ ] Implement recursive transitive resolution
  - [ ] Limit depth (default 10 levels)
  - [ ] Track visited nodes (prevent infinite loops)
  - [ ] Build complete graph structure
- [ ] Implement `resolveTransitiveDependencies()`:
  - [ ] Look up each package in lockfile
  - [ ] Find its dependencies
  - [ ] Create child nodes
  - [ ] Recurse with depth tracking

#### Cycle Detection
- [ ] Implement `detectCycles()`:
  - [ ] Use DFS with three node states: white, gray, black
  - [ ] Find back edges (indicates cycle)
  - [ ] Reconstruct cycle path
  - [ ] Return all cycles found
- [ ] Classify cycle severity:
  - [ ] 2-node cycles: usually warning
  - [ ] Longer cycles: depends on package criticality

#### Testing: Basic Graph
- [ ] Create `/test/analyzers/dependencyGraph.test.ts`
- [ ] Test simple tree:
  - [ ] Single branch (no cycles)
  - [ ] Multiple branches
  - [ ] Correct depth calculation
- [ ] Test complex structure:
  - [ ] Many transitive levels
  - [ ] Shared dependencies (diamond pattern)
- [ ] Test depth limiting:
  - [ ] Limit at 10, verify no deeper nodes
  - [ ] Unknown packages at depth boundary

#### Testing: Cycle Detection
- [ ] Test simple 2-node cycle
- [ ] Test longer cycle (A -> B -> C -> A)
- [ ] Test diamond pattern (not a cycle)
- [ ] Test multiple cycles in same graph
- [ ] Test cycle at various depths

#### Testing: Edge Cases
- [ ] Missing package in lockfile
- [ ] Package with no dependencies
- [ ] Peer dependencies (may be unresolved)
- [ ] Optional dependencies (should be included)
- [ ] Dev dependencies (should be marked)
- [ ] Large projects (memory test)

#### Graph Analysis Helpers
- [ ] Implement `getAllNodesAtDepth()`:
  - [ ] Filter nodes by specific depth
- [ ] Implement `getPathsToNode()`:
  - [ ] Find all paths from root to specific node
  - [ ] Used for impact analysis
- [ ] Implement `getNodeDependents()`:
  - [ ] Find all packages that depend on this node
  - [ ] Reverse dependency lookup

#### Documentation
- [ ] Add JSDoc comments to all public functions
- [ ] Document cycle detection algorithm
- [ ] Example graphs in comments

---

### 2.2 Transitive Vulnerability Scanner

#### Implementation
- [ ] Create `/src/analyzers/transitiveVulnerabilities.ts`
- [ ] Implement `findTransitiveVulnerabilities()`:
  - [ ] Collect all unique package@version pairs from graph
  - [ ] Batch query OSV for all versions
  - [ ] For each vulnerable package found:
    - [ ] Use `getPathsToNode()` to find all paths
    - [ ] Determine if fixable (is it a root dep?)
    - [ ] Assess impact and recommendation

#### Transitive Vulnerability Data Structure
- [ ] Define TransitiveVulnerabilityIssue:
  - [ ] Package name and version
  - [ ] Vulnerability details
  - [ ] All paths to the package
  - [ ] Whether it's fixable upstream
  - [ ] Recommendation

#### Path Analysis
- [ ] Implement `findAllPathsToPackage()`:
  - [ ] BFS from root nodes
  - [ ] Track complete path
  - [ ] Return all paths that reach target

#### Fixability Assessment
- [ ] Implement `isVulnerabilityFixable()`:
  - [ ] If direct dependency: always fixable (update in package.json)
  - [ ] If transitive: check if a direct dep can be bumped
  - [ ] Return fix options with impact assessment

#### Recommendations
- [ ] For each transitive vulnerability:
  - [ ] Check if major version bump needed
  - [ ] Check if any direct dep can be updated
  - [ ] Estimate effort to fix
  - [ ] Warn if unfixable (requires downstream changes)

#### Testing
- [ ] Create test file: `/test/analyzers/transitiveVulnerabilities.test.ts`
- [ ] Test basic detection:
  - [ ] Known vulnerable package in tree
  - [ ] Multiple vulnerabilities
  - [ ] No false positives
- [ ] Test path finding:
  - [ ] Single path to package
  - [ ] Multiple paths to same package
  - [ ] Correct path reconstruction
- [ ] Test fixability:
  - [ ] Fixable by updating direct dep
  - [ ] Unfixable (requires downstream change)
  - [ ] Multiple fix options

#### Integration with OSV
- [ ] Verify OSV batching works with transitive packages
- [ ] Test caching for repeated queries
- [ ] Test offline mode (fallback to local DB)

---

### 2.3 Breaking Changes in Transitive Dependencies

#### Implementation
- [ ] Extend `/src/analyzers/breakingChanges.ts`:
  - [ ] Existing analyzer works per package
  - [ ] No changes needed for this phase
  - [ ] Will be called on transitive deps too

#### Integration with Graph
- [ ] In check.ts: after building graph:
  - [ ] Run breaking change analysis on all graph nodes
  - [ ] Separate results by depth (direct vs transitive)
  - [ ] Highlight transitive breaking changes specially

#### Testing
- [ ] Verify breaking changes detected in transitive deps
- [ ] Ensure output clearly shows depth

---

### 2.4 Terminal Output for Transitive Issues

#### Terminal Formatting
- [ ] Update `/src/utils/terminal.ts`:
  - [ ] Add `printTransitiveVulnerabilities()` section
  - [ ] Add `printTransitiveBreakingChanges()` section
  - [ ] Add `printCycles()` section for detected cycles
  - [ ] Format with path visualization

#### Example Output
- [ ] Design output:
```
TRANSITIVE VULNERABILITIES
  react-native@0.71.0
  ├─ Dependency chain: expo@49 -> react-native@0.71.0
  ├─ Issue: CVE-2023-1234 (Medium)
  ├─ Recommendation: Upgrade expo to 50+
  └─ Effort: Low

DEPENDENCY CYCLES (⚠️ Warning)
  babel-core → babel-preset-react → babel-core
  └─ Usually harmless, but check for conflicts
```

#### Integration into check.ts
- [ ] Extend checkCommand to print transitive sections
- [ ] Add to JSON output

#### Testing
- [ ] Visual inspection of output format
- [ ] Verify all paths display correctly
- [ ] Test with complex graphs

---

## Sprint 3: Duplicate & Multiple Version Detection (Week 3-4)

### 3.1 Enhanced Duplicate Detection

#### Implementation
- [ ] Create `/src/analyzers/duplicateDependencies.ts` (new)
- [ ] Replace simple version comparison with graph-aware analysis:
  - [ ] Use dependency graph to find all versions
  - [ ] For each version, identify which packages require it
  - [ ] Analyze compatibility between versions

#### Duplicate Severity Scoring
- [ ] Implement `scoreDuplicateSeverity()`:
  - [ ] Critical packages (react, react-native): always critical
  - [ ] Navigation libraries: high
  - [ ] Others: medium (unless major version difference)
  - [ ] Exception: if versions are compatible (e.g., 18.1 and 18.2), lower severity

#### Conflict Detection
- [ ] Implement `detectVersionConflicts()`:
  - [ ] For each duplicate package
  - [ ] Compare version pairs
  - [ ] Check semver compatibility
  - [ ] Determine if both can coexist

#### Fixing Suggestions
- [ ] Implement `suggestFixes()`:
  - [ ] Option 1: Update transitive deps to match
  - [ ] Option 2: Add resolution in package.json
  - [ ] Option 3: Accept and document reason
  - [ ] Rate each option by risk

#### Testing
- [ ] Create test file: `/test/analyzers/duplicateDependencies.test.ts`
- [ ] Test detection:
  - [ ] Single duplicate (2 versions)
  - [ ] Multiple duplicates of same package
  - [ ] False positives (same version from different paths)
- [ ] Test severity scoring:
  - [ ] React: critical
  - [ ] react-navigation: high
  - [ ] Utils: medium
- [ ] Test conflict detection:
  - [ ] Compatible versions (18.1, 18.2)
  - [ ] Incompatible versions (16, 18)

---

### 3.2 React/React Native Compatibility Matrix

#### Data Structure
- [ ] Create `/src/data/reactCompatibility.ts`:
  - [ ] Define ReactNativeCompatibilityEntry
  - [ ] List 30+ RN versions with compatible React versions
  - [ ] Include Node and Hermes info

#### Compatibility Matrix Data
- [ ] Populate matrix for recent RN versions:
  - [ ] RN 0.75: React 18.2+, 19.0-beta
  - [ ] RN 0.74: React 18.2+
  - [ ] RN 0.73: React 18.0+
  - [ ] ... (continue for last 2-3 years of versions)

#### Lookup Functions
- [ ] Implement helper functions:
  - [ ] `getCompatibleReactVersions(rnVersion)`
  - [ ] `getCompatibleRNVersions(reactVersion)`
  - [ ] `isCompatible(rnVersion, reactVersion)`

#### Testing
- [ ] Create test file: `/test/data/reactCompatibility.test.ts`
- [ ] Verify all entries are valid semver
- [ ] Test lookup functions:
  - [ ] Known compatible pairs return true
  - [ ] Known incompatible pairs return false
  - [ ] Out-of-range versions handled gracefully

#### Documentation
- [ ] Document data sources (React Native releases, etc.)
- [ ] Add comments explaining any exceptions

---

### 3.3 React Duplicate Analysis

#### Implementation
- [ ] Update check.ts:
  - [ ] After finding duplicates, check for react/react-native
  - [ ] Use compatibility matrix to assess risk

#### Analysis Output
- [ ] If multiple React versions:
  - [ ] Check if compatible with each other
  - [ ] Check if compatible with installed RN version
  - [ ] Flag if one is dev-only vs production
  - [ ] Suggest fixes

#### Testing
- [ ] Real scenarios:
  - [ ] react 18 + react 18 (same, not really dup)
  - [ ] react 18 + react 16 (critical issue)
  - [ ] react-native 0.74 + 0.73 (critical issue)
  - [ ] One in devDeps only (might be OK)

---

## Sprint 4: Breaking Changes Database Expansion (Week 4-5)

### 4.1 Breaking Changes Data Collection

#### Research Phase
- [ ] Gather breaking changes for Tier 1 packages (15 total):
  - [ ] react-native: versions 0.70-0.75
  - [ ] react: versions 16-19
  - [ ] @react-navigation/*: versions 5-7
  - [ ] react-native-reanimated: versions 1-4
  - [ ] react-native-screens: versions 1-4
  - [ ] react-native-gesture-handler: versions 1-2
  - [ ] metro: versions 0.70+
  - [ ] typescript: versions 4-5
  - [ ] babel: 7.x versions
  - [ ] jest: versions 27-29
  - [ ] expo: versions 45-51
  - [ ] others (redux, react-redux, etc.)

#### Data Collection Strategy
- [ ] For each package:
  - [ ] Visit GitHub releases page
  - [ ] Read CHANGELOG files
  - [ ] Identify "BREAKING CHANGES" sections
  - [ ] Extract version where break introduced
  - [ ] Document what broke and why
  - [ ] Find migration guides or PRs

#### Breaking Change Entry Template
- [ ] For each break, document:
  - [ ] Package name
  - [ ] Introduced in version
  - [ ] Affected version range
  - [ ] Severity (critical/high/medium)
  - [ ] Category (api/behavior/dependency/platform/performance)
  - [ ] 2-3 key changes
  - [ ] Migration guide (with code examples if possible)
  - [ ] Related references (PRs, issues, docs)

#### Implementation
- [ ] Organize entries in `/src/data/breakingChanges.ts`:
  - [ ] Import existing database
  - [ ] Add new entries for Tier 1
  - [ ] Add new entries for Tier 2
  - [ ] Group by severity

#### Validation
- [ ] Create `/test/data/breakingChanges.test.ts`:
  - [ ] Verify all package names are valid
  - [ ] Verify all version strings are valid semver
  - [ ] Verify introducedInVersion is in affectedVersions
  - [ ] Verify references are properly formatted
  - [ ] Check for duplicates (same package + introduced version)

#### Testing with Real Versions
- [ ] Create a test project with RN 0.72
- [ ] Upgrade to 0.73
- [ ] Verify breaking changes detected
- [ ] Review suggested migrations

#### Documentation
- [ ] Update README with coverage list
- [ ] Create BREAKING_CHANGES_DATABASE.md guide
- [ ] Document how to add new entries

---

### 4.2 Breaking Change Analyzer Enhancements

#### Upgrade Path Analysis
- [ ] Implement `analyzeUpgradePath()`:
  - [ ] Given current and target versions
  - [ ] Find all versions between them
  - [ ] For each step, collect breaking changes
  - [ ] Suggest logical stopping points (e.g., major boundaries)
  - [ ] Estimate effort per step

#### Estimated Effort Calculation
- [ ] Implement `estimateUpgradeEffort()`:
  - [ ] Few breaking changes: low
  - [ ] Many breaking changes: high
  - [ ] Critical packages involved: high
  - [ ] Unknown changes: medium

#### Gradual Upgrade Paths
- [ ] Implement `canUpgradeGradually()`:
  - [ ] Some packages can be upgraded step-by-step
  - [ ] Others require all-at-once (e.g., RN)
  - [ ] Return true/false + explanation

#### Implementation
- [ ] Enhance `/src/analyzers/breakingChanges.ts`:
  - [ ] Add functions above
  - [ ] Return richer result structure
  - [ ] Include migration guide in results

#### Testing
- [ ] Test upgrade paths:
  - [ ] RN 0.72 -> 0.73 (has breaks)
  - [ ] RN 0.72 -> 0.75 (multiple breaks)
  - [ ] React 17 -> 18 (major transition)
- [ ] Test effort estimation
- [ ] Test gradual upgrade detection

#### Integration into check.ts
- [ ] For each dependency with older version:
  - [ ] Run upgrade path analysis to latest
  - [ ] Show breaking changes if upgrading
  - [ ] Include in summary

---

## Sprint 5: Error Handling & Fallback Modes (Week 5-6)

### 5.1 Error Classification System

#### Error Types
- [ ] Create `/src/errors/ScannerError.ts`:
  - [ ] Define ErrorCategory enum (15+ error types)
  - [ ] Define ErrorSeverity enum (info, warning, error, fatal)
  - [ ] Create ScannerError class extending Error
  - [ ] Add context, suggestion, affectedPackages fields

#### Error Categories
- [ ] File I/O errors:
  - [ ] PACKAGE_JSON_NOT_FOUND
  - [ ] LOCKFILE_NOT_FOUND
  - [ ] LOCKFILE_PARSE_ERROR
  - [ ] UNREADABLE_FILE
- [ ] Network errors:
  - [ ] OSV_API_UNREACHABLE
  - [ ] OSV_RATE_LIMITED
  - [ ] REGISTRY_UNREACHABLE
- [ ] Data errors:
  - [ ] INVALID_VERSION_SPEC
  - [ ] DEPENDENCY_NOT_RESOLVED
  - [ ] INTEGRITY_MISMATCH
- [ ] Analysis errors:
  - [ ] CIRCULAR_DEPENDENCY
  - [ ] UNMET_PEER_DEPENDENCY
  - [ ] INCOMPATIBLE_VERSIONS
- [ ] Configuration errors:
  - [ ] INVALID_NODE_VERSION
  - [ ] UNSUPPORTED_PACKAGE_MANAGER

#### Error Messages
- [ ] Create `/src/errors/errorMessages.ts`:
  - [ ] Define ErrorMessageTemplate interface
  - [ ] Create message entry for each error type
  - [ ] Include templates with variables
  - [ ] Include fix suggestions

#### Example Error Messages
- [ ] PACKAGE_JSON_NOT_FOUND:
  ```
  Cannot find package.json in /path/to/project
  
  Make sure you're running rn-dep-scanner from the root directory.
  
  Try:
    cd /path/to/your/project
    rn-dep-scanner check
  ```
- [ ] LOCKFILE_PARSE_ERROR:
  ```
  Failed to parse yarn.lock: Invalid entry at line 45
  
  The lockfile may be corrupted.
  
  Fix:
    1. npm install (to regenerate lockfile)
    2. Re-run: rn-dep-scanner check
  ```

#### Testing
- [ ] Create test file: `/test/errors/errorHandling.test.ts`
- [ ] Test error creation with context
- [ ] Test message templating with variables
- [ ] Test JSON serialization

---

### 5.2 Fallback Mechanisms

#### Degraded Modes
- [ ] Implement fallback in check.ts:
  - [ ] If lockfile fails to parse: analyze package.json only
  - [ ] If OSV unreachable: use cached data
  - [ ] If invalid version: skip and continue
  - [ ] If node_modules missing: use lockfile + package.json

#### Mode 1: No Lockfile
- [ ] Use package.json declared versions
- [ ] Skip resolved version analysis
- [ ] Skip transitive dependency scanning
- [ ] Show warning: "Lockfile not found, using declared versions only"

#### Mode 2: Offline (OSV unavailable)
- [ ] Use cached vulnerability data (if available)
- [ ] Use local vulnerability database
- [ ] Show warning: "Using cached vulnerability data (last updated: ...)"
- [ ] Time-stamp cache age

#### Mode 3: Invalid Versions
- [ ] Skip packages with invalid semver
- [ ] Continue with valid packages
- [ ] Log which packages were skipped
- [ ] Show count in summary

#### Mode 4: Minimal (on unknown error)
- [ ] Read and analyze package.json only
- [ ] Skip all advanced features
- [ ] Show error details + suggestion to file bug

#### Implementation
- [ ] Update check.ts with try-catch wrapping:
  ```typescript
  try {
    return await fullAnalysis();
  } catch (error) {
    if (error.code === 'LOCKFILE_PARSE_ERROR') {
      return await degradedAnalysis_NoLockfile();
    } else if (error.code === 'OSV_API_UNREACHABLE') {
      return await degradedAnalysis_Offline();
    }
  }
  ```

#### Testing
- [ ] Create scenarios:
  - [ ] Corrupt lockfile (simulate parse error)
  - [ ] Missing lockfile (file not found)
  - [ ] Network down (mock OSV API failure)
  - [ ] Invalid semver in package.json
- [ ] Verify each degraded mode:
  - [ ] Still produces output
  - [ ] Shows appropriate warnings
  - [ ] No crashes
  - [ ] Accurate counts

---

### 5.3 Error Recovery & User Guidance

#### Error Handling in Each Component
- [ ] Package.json reading:
  - [ ] Wrap in try-catch
  - [ ] Throw PACKAGE_JSON_NOT_FOUND
  - [ ] Suggest checking path
  
- [ ] Lockfile parsing:
  - [ ] Each parser has error handling
  - [ ] Throw LOCKFILE_PARSE_ERROR with details
  - [ ] Include line number if known
  
- [ ] Version comparison:
  - [ ] Catch invalid semver
  - [ ] Throw INVALID_VERSION_SPEC
  - [ ] Continue with other versions
  
- [ ] OSV queries:
  - [ ] Catch network errors
  - [ ] Throw OSV_API_UNREACHABLE
  - [ ] Fall back to cache/local DB

#### User-Facing Error Output
- [ ] Format errors with:
  - [ ] Error code (for documentation lookup)
  - [ ] Human-readable message
  - [ ] What went wrong (plain language)
  - [ ] Why it matters
  - [ ] How to fix (actionable steps)
- [ ] Example output:
  ```
  ERROR: [LOCKFILE_PARSE_ERROR]
  Failed to parse yarn.lock
  
  Problem: Invalid YAML at line 45
  
  This usually means your lockfile is corrupted.
  
  Solutions (try in order):
    1. npm install
    2. Delete yarn.lock and run yarn install
    3. Check git for recent lockfile changes
    4. Update your package manager
  
  Still stuck? File an issue: github.com/.../issues
  ```

#### Testing
- [ ] Create test scenarios for each error
- [ ] Verify error messages are helpful
- [ ] Test on team (UX review)

---

## Sprint 6: Testing & Integration (Week 5)

### 6.1 Test Infrastructure

#### Test Fixtures
- [ ] Create `/test/fixtures/` directory structure:
  ```
  /test/fixtures/
    /lockfiles/
      /npm/
        ├─ v1-simple.json
        ├─ v3-complex.json
        └─ monorepo.json
      /yarn/
        ├─ v1-simple.lock
        ├─ v3-with-workspaces.yaml
      /pnpm/
        ├─ v9-simple.yaml
        ├─ monorepo.yaml
      /bun/
        ├─ v6-simple.lock
    /graphs/
      ├─ circular-deps.json
      ├─ deep-tree.json
      ├─ wide-tree.json
    /breaking-changes/
      ├─ react-native-0-72-to-0-73.json
  ```

#### Fixture Helper
- [ ] Create `/test/helpers/fixtures.ts`:
  - [ ] `loadLockfile(format, filename)`
  - [ ] `createMockPackageJson(deps)`
  - [ ] `createMockLockfile(format, deps, transitive?)`
  - [ ] `createDependencyGraph(structure)`

#### Real Lockfile Collection
- [ ] Clone/download test projects:
  - [ ] Popular RN app with npm
  - [ ] Expo project with yarn
  - [ ] Monorepo with pnpm
  - [ ] Project using bun (if possible)
- [ ] Extract lockfiles to test/fixtures/
- [ ] Strip sensitive info
- [ ] Commit as test data

#### Vulnerability Test Data
- [ ] Create mock OSV responses
- [ ] Create known vulnerable dependency scenarios
- [ ] Use in offline testing

#### Testing
- [ ] Verify all fixtures load correctly
- [ ] Verify fixture-based tests pass

---

### 6.2 Comprehensive Test Suite

#### Parser Tests (45 total)
- [ ] npm: 15 tests
- [ ] yarn: 15 tests
- [ ] pnpm: 10 tests
- [ ] bun: 5 tests

#### Graph Tests (25 total)
- [ ] Construction: 10 tests
- [ ] Cycle detection: 8 tests
- [ ] Analysis: 7 tests

#### Analysis Tests (40 total)
- [ ] Duplicate detection: 15 tests
- [ ] Transitive vulnerabilities: 10 tests
- [ ] Breaking changes: 10 tests
- [ ] Compatibility: 5 tests

#### Error Tests (25 total)
- [ ] Error creation: 5 tests
- [ ] Error messages: 5 tests
- [ ] Fallback modes: 10 tests
- [ ] Recovery: 5 tests

#### Integration Tests (20 total)
- [ ] Full pipeline: 10 tests
- [ ] Cross-module: 10 tests

#### Performance Tests (10 total)
- [ ] Large project (500+ deps)
- [ ] Deep trees (10+ levels)
- [ ] Wide trees (100+ root deps)
- [ ] Memory usage
- [ ] Execution time

#### Total: ~165 tests

#### Execution
- [ ] Run all tests: `npm run test`
- [ ] Coverage report: `npm run test -- --coverage`
- [ ] Performance benchmarks if applicable

#### CI/CD Integration
- [ ] Update GitHub Actions (if applicable)
- [ ] Tests must pass on commit
- [ ] Coverage must be >95%

---

### 6.3 Documentation

#### Architecture Document
- [ ] Create `/docs/ARCHITECTURE.md`:
  - [ ] Overview of Phase 2 changes
  - [ ] Module dependency diagram
  - [ ] Data flow for each feature
  - [ ] Integration points

#### Lockfile Formats Guide
- [ ] Create `/docs/LOCKFILE_FORMATS.md`:
  - [ ] npm format specification
  - [ ] Yarn format (v1, v2, v3)
  - [ ] pnpm format
  - [ ] Bun format
  - [ ] Parser implementation details

#### Breaking Changes Database Guide
- [ ] Create `/docs/BREAKING_CHANGES_DATABASE.md`:
  - [ ] How to add new entries
  - [ ] Template for entries
  - [ ] Where to find information
  - [ ] Validation checklist
  - [ ] List of covered packages

#### Extending Guide
- [ ] Create `/docs/EXTENDING.md`:
  - [ ] How to add new analyzers
  - [ ] How to add new lockfile parsers
  - [ ] Type system & interfaces
  - [ ] Testing patterns

#### README Updates
- [ ] Update `/README.md`:
  - [ ] Phase 2 feature list
  - [ ] Usage examples
  - [ ] Supported lockfile formats
  - [ ] Performance notes
  - [ ] Known limitations

#### CHANGELOG
- [ ] Update `CHANGELOG.md`:
  - [ ] v2.0.0 entry
  - [ ] All new features
  - [ ] Breaking changes
  - [ ] Migration guide from v1.x

---

## Final Verification (Week 6)

### Code Quality
- [ ] [ ] TypeScript strict mode: no errors
  ```bash
  npm run build
  ```
- [ ] [ ] No npm vulnerabilities
  ```bash
  npm audit
  ```
- [ ] [ ] Code formatting (if using prettier)
- [ ] [ ] Linting (if using eslint)
- [ ] [ ] Test coverage >95%
  ```bash
  npm run test -- --coverage
  ```

### Functional Testing
- [ ] [ ] Test on real RN projects (3-5 projects):
  - [ ] npm lockfile
  - [ ] yarn lockfile
  - [ ] pnpm lockfile
  - [ ] Monorepo
  - [ ] Large project (500+ deps)
- [ ] [ ] Verify all output sections display correctly
- [ ] [ ] Verify JSON output is valid and complete
- [ ] [ ] Verify error messages are helpful

### Performance Testing
- [ ] [ ] Medium project (<100 direct deps): <5 seconds
- [ ] [ ] Large project (>500 direct deps): <15 seconds
- [ ] [ ] Memory usage stays <100MB
- [ ] [ ] No memory leaks (run multiple times)

### Package Publishing
- [ ] [ ] Update version in package.json to 2.0.0
- [ ] [ ] Update dist files
  ```bash
  npm run build
  ```
- [ ] [ ] Verify package.json files array only includes needed files
- [ ] [ ] Create and test tarball
  ```bash
  npm pack
  tar -tzf rn-dep-scanner-2.0.0.tgz | head -20
  ```
- [ ] [ ] Final audit of package size
- [ ] [ ] Tag release in git
  ```bash
  git tag v2.0.0
  ```

### Documentation Review
- [ ] [ ] README is accurate and complete
- [ ] [ ] All code examples work
- [ ] [ ] Architecture doc is clear
- [ ] [ ] Breaking changes guide is usable
- [ ] [ ] CHANGELOG is complete

### Release Checklist
- [ ] [ ] All tests passing
- [ ] [ ] Code review approved
- [ ] [ ] Documentation complete
- [ ] [ ] Performance verified
- [ ] [ ] No security issues
- [ ] [ ] Version bumped to 2.0.0
- [ ] [ ] Git tag created
- [ ] [ ] CHANGELOG updated
- [ ] [ ] Ready for npm publish

---

## Post-Release (Week 7+)

### Monitoring
- [ ] [ ] Monitor npm downloads
- [ ] [ ] Collect user feedback
- [ ] [ ] Watch for bug reports
- [ ] [ ] Track GitHub issues

### Quick Fixes (2.0.1)
- [ ] [ ] Any parser bugs
- [ ] [ ] Error message improvements
- [ ] [ ] Performance issues

### Phase 3 Prep
- [ ] [ ] Plan New Architecture support
- [ ] [ ] Plan Hermes detection
- [ ] [ ] Plan transitive monorepo support
- [ ] [ ] Plan CI/CD integration

---

## Sign-Off

- **Implementation Lead**: [Name]
- **Code Review**: [Name]
- **Testing**: [Name]
- **Documentation**: [Name]
- **Release Date**: 2026-11-30 (estimated)

---

**Last Updated**: 2026-08-31
**Status**: Ready for Sprint 1
