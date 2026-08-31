# Phase 2 Implementation Plan - Complete End-to-End

## Overview
Phase 2 focuses on multi-package-manager support, transitive dependency detection, duplicate version detection, and enhanced error handling.

## Features to Implement

### 1. Fix & Complete Lockfile Parsers (Foundation)
**Status**: Parsers exist but incomplete
**Files**: 
- `src/parsers/yarnLockParser.ts` - needs proper yarn.lock v2 parsing
- `src/parsers/pnpmLockParser.ts` - needs proper pnpm-lock.yaml parsing
- `src/parsers/bunLockParser.ts` - needs proper bun.lockb parsing (binary)
- `src/parsers/npmLockParser.ts` - already working

**Test Requirements**:
- Unit tests for each parser with real lockfile samples
- Edge cases: scoped packages, workspaces, prerelease versions
- Test with all package managers

### 2. Transitive Dependency Scanning
**Status**: Not implemented
**New Files**:
- `src/utils/transitiveResolver.ts` - resolve transitive deps from lockfile
- `src/types/dependency.ts` - extend with transitive depth tracking

**Implementation**:
- Walk dependency tree from lockfile
- Track depth and parent packages
- Report issues with full path context

**Test Requirements**:
- Test with monorepos
- Test with nested conflicts
- Performance test with large dependency graphs

### 3. Duplicate Version Detection
**Status**: Partially done (in versionDetection.ts)
**Files**:
- `src/utils/versionDetection.ts` - enhance duplicate detection
- Update `src/commands/check.ts` - better reporting

**Implementation**:
- Detect multiple versions of same package (esp React, React Native)
- Report severity based on version compatibility
- Suggest how to deduplicate

**Test Requirements**:
- Test with monorepos that have multiple RN versions
- Test with peer dependency conflicts

### 4. Enhanced Breaking Changes Database
**Status**: Exists but limited
**Files**:
- `src/analyzers/breakingChanges.ts` - expand rules
- `src/data/breakingChanges.ts` (new)

**Implementation**:
- Add breaking changes for common packages (Redux, Firebase, Expo, etc.)
- Include more detailed migration guides
- Test data validation

**Test Requirements**:
- Verify each breaking change against real package versions
- Test version range matching

### 5. Better Error Messages & Handling
**Status**: Partially done (removed OSV errors)
**Files**:
- `src/commands/check.ts` - improve error context
- Add better offline detection

**Test Requirements**:
- Test with missing package.json
- Test with invalid lockfile
- Test with corrupted data

---

## Implementation Order

1. **Phase 2.1**: Fix yarn/pnpm lockfile parsers (foundation)
   - Proper v2+ support for yarn
   - Proper pnpm-lock.yaml parsing
   - Test each parser thoroughly

2. **Phase 2.2**: Implement transitive dependency resolution
   - Extract transitive deps from lockfile
   - Build dependency graph
   - Detect transitive conflicts

3. **Phase 2.3**: Enhance duplicate/version detection
   - Improve detection logic
   - Better reporting
   - Conflict resolution suggestions

4. **Phase 2.4**: Expand breaking changes database
   - Add 10+ popular packages
   - Validate all data
   - Test coverage

5. **Phase 2.5**: Improve error handling
   - Better messages
   - Graceful degradation
   - Testing

---

## Testing Strategy

### Unit Tests
- Each parser independently
- Transitive resolver logic
- Version comparison logic

### Integration Tests
- Full CLI flow with different package managers
- Real project testing
- Edge cases and error scenarios

### Manual Testing
- Real React Native projects
- Monorepos
- Different lock file versions

---

## Success Criteria
- ✅ All package managers work reliably
- ✅ Transitive issues detected
- ✅ No false positives
- ✅ No regressions to Phase 1
- ✅ >90% test coverage on new code
