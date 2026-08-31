# Phase 2 Implementation Quick Start

A condensed reference for developers implementing Phase 2 features.

---

## Overview

| Feature | Timeline | Priority | Status |
|---------|----------|----------|--------|
| Lockfile Parsers (Yarn, pnpm, Bun) | 2 weeks | P0 | Not started |
| Transitive Dependency Scanning | 2 weeks | P0 | Not started |
| Duplicate/Multiple Version Detection | 1 week | P0 | Not started |
| Enhanced Breaking Change DB | 2 weeks | P1 | Not started |
| Error Handling & Fallbacks | 1 week | P2 | Not started |
| Testing & Documentation | 1 week | P1 | Not started |
| **Total** | **6-8 weeks** | - | **In Design** |

---

## Architecture at a Glance

### Phase 2 Data Flow
```
package.json + lockfile
        ↓
  [Lockfile Parsers]
  (npm/yarn/pnpm/bun)
        ↓
  Parsed dependencies
        ↓
  [Dependency Graph Builder]
        ↓
  Complete dependency tree
  with transitive deps
        ↓
  [Parallel Analyzers]
  ├─ Transitive vulnerabilities
  ├─ Duplicate detection
  ├─ Breaking changes
  └─ Peer conflicts
        ↓
  Enhanced output with
  depth info & recommendations
```

### New Modules

**Parsers:**
- `src/parsers/yarnLockParser.ts` - Yarn v1/v2/v3 support
- `src/parsers/pnpmLockParser.ts` - pnpm lockfile parsing
- `src/parsers/bunLockParser.ts` - Bun lockfile support

**Analysis:**
- `src/analyzers/dependencyGraph.ts` - Builds transitive tree
- `src/analyzers/duplicateDependencies.ts` - Finds duplicates
- `src/analyzers/transitiveVulnerabilities.ts` - Finds vulns in tree

**Data:**
- `src/data/reactCompatibility.ts` - React/RN version matrix
- `src/data/breakingChanges.ts` - Expanded from 10 to 50+ entries

**Errors:**
- `src/errors/ScannerError.ts` - Error classification
- `src/errors/errorMessages.ts` - User-friendly messages

**Types:**
- `src/types/graph.ts` - Dependency graph interfaces
- Extended `src/types/lockfile.ts` - Workspace support

---

## Key Data Structures

### DependencyGraph
```typescript
{
  roots: Map<string, DependencyNode>,    // Direct deps
  allNodes: Map<string, DependencyNode[]>, // All nodes
  cycles: CycleInfo[],                   // Detected cycles
  unresolvedDependencies: UnresolvedDep[]
}

DependencyNode {
  name, version, requestedRange, type, parent,
  children: Map<string, DependencyNode[]>,
  depth, isDev, isOptional
}
```

### ParsedLockfile (Enhanced)
```typescript
{
  manager: PackageManager,
  dependencies: Map<string, ResolvedDependency>,
  dependencyGraph?: DependencyGraph,      // NEW
  workspaceInfo?: WorkspaceInfo,          // NEW
  parseWarnings?: string[],               // NEW
  timestamp
}
```

### DuplicateDependencyInfo (New)
```typescript
{
  package: string,
  versions: string[],
  usedBy: Map<string, string[]>,        // Who needs which version
  conflicts: VersionConflict[],         // Incompatibility info
  suggestions: DuplicateSuggestion[],   // How to fix
  severity: 'critical' | 'high' | 'medium' | 'low',
  affectsRuntime: boolean
}
```

---

## Checklist by Feature

### Feature 1: Lockfile Parsing (2 weeks)

**Yarn Parser:**
- [ ] Parse v1 text format (package@range: ... version ...)
- [ ] Parse v2+ YAML format
- [ ] Detect version automatically
- [ ] Handle scoped packages (@scope/pkg)
- [ ] Support workspace detection
- [ ] Test with real yarn.lock files
- [ ] 15+ test cases

**pnpm Parser:**
- [ ] Parse YAML lockfile
- [ ] Extract packages section
- [ ] Resolve versions correctly
- [ ] Support monorepo importers
- [ ] Handle hoisting modes
- [ ] Test with real pnpm-lock.yaml files
- [ ] 10+ test cases

**Bun Parser:**
- [ ] Detect binary vs text format
- [ ] Parse text format (similar to Yarn v1)
- [ ] Stub binary format (for Phase 2)
- [ ] Test with bun.lock files
- [ ] 5+ test cases

**Integration:**
- [ ] Update parseLockfile() in lockfile.ts
- [ ] Test manager detection logic
- [ ] Verify unified output format

---

### Feature 2: Transitive Scanning (2 weeks)

**Dependency Graph:**
- [ ] Build tree from package.json roots
- [ ] Recursively resolve transitive deps
- [ ] Limit depth (default 10 levels)
- [ ] Detect cycles (DFS algorithm)
- [ ] Track node relationships
- [ ] 20+ test cases including cycles

**Vulnerability Scanning:**
- [ ] Collect all unique package@version pairs
- [ ] Query OSV for each
- [ ] Find all paths to vulnerable packages
- [ ] Determine if fixable upstream
- [ ] Generate recommendations
- [ ] 15+ test cases

**Breaking Changes in Tree:**
- [ ] Run existing analyzer on all graph nodes
- [ ] Separate results by depth
- [ ] Highlight transitive breaks

---

### Feature 3: Duplicate Detection (1 week)

**Enhanced Detection:**
- [ ] Use dependency graph to find all versions
- [ ] Track which packages require each version
- [ ] Detect version conflicts
- [ ] Score severity based on package type
- [ ] Generate fix suggestions
- [ ] 15+ test cases

**React Compatibility:**
- [ ] Create matrix of React/RN versions
- [ ] Implement lookup functions
- [ ] Special handling for react duplicates
- [ ] Check compatibility between versions

---

### Feature 4: Breaking Changes DB (2 weeks)

**Data Expansion:**
- [ ] Research Tier 1 packages (15 total)
- [ ] Research Tier 2 packages (20 total)
- [ ] Document breaking changes per version
- [ ] Write migration guides
- [ ] Collect references (links, PRs, etc.)
- [ ] 55+ new database entries

**Analyzer Enhancement:**
- [ ] Implement upgrade path analysis
- [ ] Calculate effort estimates
- [ ] Detect gradual vs all-at-once upgrades
- [ ] Return enriched results

**Validation:**
- [ ] All entries valid semver
- [ ] References are real URLs
- [ ] No duplicate entries
- [ ] Migration guides non-empty for critical
- [ ] 30+ test cases

---

### Feature 5: Error Handling (1 week)

**Error Classification:**
- [ ] Define 15+ error categories
- [ ] Map to severity levels
- [ ] Create ScannerError class
- [ ] Implement toJSON() for API usage

**Error Messages:**
- [ ] Create template for each error
- [ ] Include: problem, why it matters, how to fix
- [ ] Add links to documentation
- [ ] 15+ message templates

**Fallback Modes:**
- [ ] No lockfile → use package.json only
- [ ] OSV down → use cache/local DB
- [ ] Invalid version → skip and continue
- [ ] Unknown error → minimal check

---

### Feature 6: Testing & Docs (1 week)

**Test Fixtures:**
- [ ] Collect 3-5 real lockfile examples per format
- [ ] Create mock lockfiles for edge cases
- [ ] Create dependency graph fixtures
- [ ] Setup fixture loader helpers

**Test Suite:**
- [ ] 45 parser tests
- [ ] 25 graph tests
- [ ] 40 analysis tests
- [ ] 25 error tests
- [ ] 20 integration tests
- [ ] 10 performance tests
- [ ] **Total: ~165 tests**

**Documentation:**
- [ ] Architecture.md (Phase 2 overview)
- [ ] LOCKFILE_FORMATS.md (parser specs)
- [ ] BREAKING_CHANGES_DATABASE.md (how to add entries)
- [ ] EXTENDING.md (how to extend)
- [ ] Update README.md
- [ ] Update CHANGELOG.md

---

## Common Algorithms

### Cycle Detection
```
algorithm: DFS-based cycle detection
state: white (unvisited), gray (in-progress), black (done)
detect: back edges (node → ancestor)
return: all cycles found
```

### Path Finding
```
algorithm: BFS from all roots
goal: find all paths to target node
return: list of path arrays
```

### Version Compatibility
```
algorithm: semantic version matching (semver library)
check: semver.satisfies(version, range)
handle: ^, ~, >=, <, etc.
```

---

## Testing Patterns

### Parser Test Template
```typescript
test('parses simple dependency', () => {
  const content = `...lockfile content...`;
  const parser = new [Format]Parser();
  const result = parser.parse(content);
  
  expect(result.manager).toBe('[format]');
  expect(result.dependencies.get('react')).toBeDefined();
  expect(result.dependencies.get('react')?.resolvedVersion).toBe('18.2.0');
});
```

### Graph Test Template
```typescript
test('builds graph with transitive deps', () => {
  const graph = buildDependencyGraph(mockLockfile, mockPackageJson);
  
  expect(graph.roots.size).toBe(2); // direct deps
  expect(graph.allNodes.get('react')).toBeDefined();
  expect(graph.cycles.length).toBe(0);
});
```

### Analysis Test Template
```typescript
test('detects duplicate versions', () => {
  const duplicates = detectDuplicates(graph);
  
  expect(duplicates).toHaveLength(1);
  expect(duplicates[0].package).toBe('react');
  expect(duplicates[0].versions).toEqual(['16.8.6', '18.2.0']);
});
```

---

## Performance Targets

| Scenario | Target | Threshold |
|----------|--------|-----------|
| Small project (<100 deps) | <2s | <5s |
| Medium project (100-500 deps) | <5s | <10s |
| Large project (500+ deps) | <10s | <20s |
| Memory usage | <50MB | <100MB |

---

## Version Compatibility Matrix Example

```typescript
const reactNativeCompatibilityMatrix = [
  {
    reactNativeVersion: '0.75.0',
    reactVersions: ['^18.2.0', '^19.0.0-beta'],
    nodeVersions: ['18.x', '20.x'],
    hermes: true,
    newArch: true,
  },
  // ... 30+ more entries
];
```

---

## Breaking Change Entry Example

```typescript
{
  package: 'react-native',
  introducedInVersion: '0.73.0',
  affectedVersions: ['>=0.73.0'],
  severity: 'critical',
  category: 'api',
  changes: [
    'Removed Flipper support by default',
    'Changed TypeScript requirements',
  ],
  migrationGuide: '## Migration steps...',
  references: [
    {
      type: 'CHANGELOG',
      url: 'https://...',
      title: 'RN v0.73.0 Release'
    }
  ]
}
```

---

## Error Handling Pattern

```typescript
try {
  return await fullAnalysis();
} catch (error) {
  if (error instanceof ScannerError) {
    switch (error.code) {
      case ErrorCategory.LOCKFILE_PARSE_ERROR:
        return degradedAnalysis_NoLockfile();
      case ErrorCategory.OSV_API_UNREACHABLE:
        return degradedAnalysis_Offline();
      // ... other cases
    }
  }
  throw error;
}
```

---

## File Checklist

### Files to Create
- [ ] `src/parsers/yarnLockParser.ts` (rewrite)
- [ ] `src/parsers/pnpmLockParser.ts` (rewrite)
- [ ] `src/parsers/bunLockParser.ts` (rewrite)
- [ ] `src/analyzers/dependencyGraph.ts`
- [ ] `src/analyzers/duplicateDependencies.ts`
- [ ] `src/analyzers/transitiveVulnerabilities.ts`
- [ ] `src/types/graph.ts`
- [ ] `src/data/reactCompatibility.ts`
- [ ] `src/errors/ScannerError.ts`
- [ ] `src/errors/errorMessages.ts`
- [ ] `test/parsers/yarnLockParser.test.ts`
- [ ] `test/parsers/pnpmLockParser.test.ts`
- [ ] `test/parsers/bunLockParser.test.ts`
- [ ] `test/analyzers/dependencyGraph.test.ts`
- [ ] `test/helpers/fixtures.ts`
- [ ] `docs/ARCHITECTURE.md`
- [ ] `docs/LOCKFILE_FORMATS.md`
- [ ] `docs/BREAKING_CHANGES_DATABASE.md`
- [ ] `docs/EXTENDING.md`

### Files to Modify
- [ ] `src/types/lockfile.ts` (extend)
- [ ] `src/types/dependency.ts` (extend)
- [ ] `src/utils/lockfile.ts` (update routing)
- [ ] `src/analyzers/breakingChanges.ts` (enhance)
- [ ] `src/data/breakingChanges.ts` (expand)
- [ ] `src/commands/check.ts` (integrate)
- [ ] `src/utils/terminal.ts` (new sections)
- [ ] `README.md` (update)
- [ ] `package.json` (version bump)

---

## Testing Command Reference

```bash
# Run all tests
npm run test

# Run specific test file
npm run test -- test/parsers/yarnLockParser.test.ts

# Run with coverage
npm run test -- --coverage

# Build for testing
npm run build

# Check types
npx tsc --noEmit

# Check for vulnerabilities
npm audit
```

---

## Git Workflow

```bash
# Start feature
git checkout -b phase-2/feature-name

# Commit regularly
git commit -m "type: description"

# Types: feat, fix, test, docs, refactor

# Example commits:
# feat: implement yarn lockfile parser
# test: add cycle detection tests
# docs: add breaking changes guide
# refactor: improve error handling

# Push branch
git push -u origin phase-2/feature-name

# Create PR for review
```

---

## Code Quality Gate

**Before committing:**
```bash
npm run build          # TypeScript strict mode
npm run test           # All tests pass
npm audit              # No vulnerabilities
```

**Before creating PR:**
```bash
npm run test -- --coverage    # >95% coverage
# Manual code review checklist
```

**Before release:**
- [ ] All tests passing
- [ ] Code reviewed and approved
- [ ] Performance verified
- [ ] Documentation complete
- [ ] Version bumped to 2.0.0
- [ ] CHANGELOG updated

---

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Lockfile parser fails on real file | Compare with test fixture, add edge case |
| Graph memory grows too large | Check depth limiting, implement lazy loading |
| Cycle detection is slow | Verify DFS implementation, add cycle cache |
| OSV batching hits limit | Verify batch size (<1000), check timeouts |
| Test fixtures hard to maintain | Use fixture helpers, document structure |

---

## Documentation Templates

### New Analyzer
```typescript
/**
 * Analyzes [feature] in dependency graph
 * 
 * @param graph - Dependency graph from buildDependencyGraph()
 * @param options - Analysis options
 * @returns Array of issues found
 * 
 * @example
 * const issues = analyzeFeature(graph);
 * issues.forEach(issue => console.log(issue.message));
 */
export function analyzeFeature(
  graph: DependencyGraph,
  options?: AnalysisOptions
): IssueResult[] {
  // Implementation
}
```

---

## Dependencies

**Already available:**
- semver (version comparison)
- chalk (terminal colors)
- commander (CLI)
- ora (spinners)

**May need to add:**
- YAML parser (if not using simple regex for pnpm)
- No additional dependencies preferred

---

## Success Metrics

- ✅ All 165+ tests passing
- ✅ TypeScript strict mode: 0 errors
- ✅ npm audit: 0 vulnerabilities
- ✅ Code coverage: >95%
- ✅ Performance: <5s for medium projects
- ✅ Documentation: Complete with examples
- ✅ Real-world testing: Tested on 5+ projects
- ✅ User-facing: Helpful error messages

---

## Useful Links

**Lockfile Specifications:**
- npm: https://docs.npmjs.com/cli/v9/configuring-npm/package-lock-json
- Yarn: https://classic.yarnpkg.com/docs/lockfile/
- pnpm: https://pnpm.io/lockfile
- Bun: https://bun.sh/docs/install/lockfile

**React Native:**
- Releases: https://github.com/facebook/react-native/releases
- Upgrading: https://reactnative.dev/docs/upgrading
- Compatibility: https://github.com/facebook/react-native#react

**Vulnerability Data:**
- OSV: https://osv.dev/
- npm Security: https://www.npmjs.com/advisories

**Development:**
- TypeScript: https://www.typescriptlang.org/
- semver: https://docs.npmjs.com/package/semver
- Jest: https://jestjs.io/ (if using for tests)

---

**Last Updated**: 2026-08-31  
**Ready for Implementation**: Yes
