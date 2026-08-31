# rn-dep-scanner

A comprehensive React Native dependency scanner that detects compatibility issues, breaking changes, and security vulnerabilities in your project.

## Features

### Core Analysis
- **Compatibility Analysis** — Detects version mismatches with React and React Native
- **Breaking Change Detection** — Alerts on major breaking changes in dependencies
- **Security Vulnerability Scanning** — Identifies known CVEs and security issues (powered by OSV.dev)
- **Resolved Version Detection** — Analyzes actual installed versions from lock files

### Dependency Intelligence
- **Version Detection** — Compares declared vs installed vs latest versions
- **Duplicate Detection** — Finds multiple versions of critical packages (react, react-native)
- **Peer Conflict Detection** — Identifies incompatible peer dependency requirements
- **Deprecated Package Detection** — Warns about outdated/superseded packages
- **React ↔ React Native Compatibility** — Validates major version compatibility

### Developer Experience
- **Health Score** — 0-100 score with detailed breakdown
- **Enhanced Output** — Color-coded sections with clear action items
- **Package Manager Detection** — Supports npm, yarn, pnpm, and bun
- **JSON Output** — Machine-readable output for CI/CD integration
- **Outdated Command** — Lists available updates categorized by severity
- **Strict Mode** — Exit codes for automated quality gates

## What's New in v1.2 (Phase 2)

### Package Manager Support
✅ **Multi-Package Manager** — Supports npm, yarn, pnpm, and bun lockfiles  
✅ **Yarn Lock v2+** — Proper parsing with scoped package support  
✅ **PNPM Support** — Complete pnpm-lock.yaml parsing  
✅ **Bun Ready** — Parser ready for bun package manager  

### Enhanced Breaking Changes Database
✅ **14+ Popular Packages** — Expanded breaking changes detection:
   - react-native (all versions)
   - @react-navigation/native
   - react-native-reanimated
   - redux, expo, firebase
   - react-native-gesture-handler
   - react-native-svg, expo-camera
   - @react-native-community/async-storage
   - And more...

### Core Features (Phase 1 + 2)
✅ **Enhanced CLI Output** — Health score (0-100), colored sections, better formatting  
✅ **Version Detection** — Shows declared vs installed vs latest for each package  
✅ **Duplicate Detection** — Identifies multiple versions of same package (critical for react/react-native)  
✅ **Peer Dependency Conflicts** — Detects incompatible peer dependency requirements  
✅ **React ↔ React Native Compatibility** — Validates major version compatibility  
✅ **Deprecated Package Detection** — Warns about deprecated packages with replacements  
✅ **Comprehensive Tests** — 24 unit + integration tests (100% passing)

## What's New in v1.1

✅ **OSV.dev Integration** — Real-time vulnerability data instead of hardcoded CVEs  
✅ **Proper Version Comparison** — Fixed semantic versioning bugs (was using string comparison)  
✅ **Lockfile Parsing** — Extracts resolved versions from package lock files  
✅ **Clear Compatibility Status** — Distinguishes "not checked" from "compatible"  
✅ **Security References** — Each finding includes CVE/GHSA IDs and source URLs  
✅ **Offline Mode** — Local cache with 24-hour TTL for when OSV is unavailable

## Installation

```bash
npm install -g rn-dep-scanner
```

Or use with `npx`:

```bash
npx rn-dep-scanner
```

## Usage

### Basic Check

```bash
rn-dep-scanner check
```

Output:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   RN Deps Scanner
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Environment
───────────
✓ React Native: 0.83.0
✓ React: 19.2.0
ℹ Package Manager: npm

Analyzing Dependencies
──────────────────────

Breaking Changes
────────────────
⚠️  CRITICAL  react-native-reanimated@4.1.0
  • Removed Animated API compatibility
  • Changed worklet syntax and compilation

Security Vulnerabilities
────────────────────────
🔒 react-native-webview@11.25.0
  🔴 CVE-2023-9999: XSS vulnerability in postMessage API
     Fix: upgrade to 11.26.0

Summary
───────
8 dependencies checked
8 compatible
⚡ Breaking changes detected: 1
🔒 Security vulnerabilities: 1
```

### JSON Output

For CI/CD integration:

```bash
rn-dep-scanner check --json
```

Returns:

```json
{
  "reactNative": {
    "current": "0.83.0"
  },
  "react": {
    "current": "19.2.0"
  },
  "packageManager": "npm",
  "summary": {
    "total": 8,
    "compatible": 8,
    "warnings": 0,
    "errors": 0,
    "breakingChanges": 1,
    "securityVulnerabilities": 1
  },
  "issues": [],
  "breakingChanges": [
    {
      "package": "react-native-reanimated",
      "version": "4.1.0",
      "severity": "critical",
      "changes": [
        "Removed Animated API compatibility",
        "Changed worklet syntax and compilation",
        "Modified gesture handler integration"
      ]
    }
  ],
  "securityVulnerabilities": [
    {
      "package": "react-native-webview",
      "version": "11.25.0",
      "vulnerabilities": [
        {
          "id": "CVE-2023-9999",
          "severity": "critical",
          "description": "XSS vulnerability in postMessage API",
          "affectedVersions": ["<11.26.0"],
          "fixedVersion": "11.26.0"
        }
      ]
    }
  ]
}
```

### Strict Mode

Exit with code 1 if there are errors or critical issues:

```bash
rn-dep-scanner check --strict
```

### Custom Working Directory

Check a specific directory:

```bash
rn-dep-scanner check --cwd /path/to/project
```

### Enhanced Output Features (v1.2+)

The `check` command now displays:

```
Health Score: 87/100
  ├─ ✓ Compatible:    12
  ├─ ⚠ Warnings:      2
  └─ ✗ Errors:        1

📦 Total dependencies: 15
   ├─ Direct: 8
   ├─ Dev: 6
   └─ Peer: 1

🔀 Duplicate versions: 1
⚠️  Peer conflicts: 1
🔨 Breaking changes: 2
🔓 Security vulnerabilities: 1
📦 Deprecated packages: 0
```

**Version Detection:**
- Shows declared (package.json) vs installed (lockfile) vs latest versions
- Highlights mismatches that could cause runtime issues

**Duplicate Detection:**
- Identifies multiple versions of the same package
- Marks critical packages (react, react-native) as high priority
- Helps resolve dependency tree issues

**Peer Conflicts:**
- Shows exactly which package depends on incompatible versions
- Explains the version mismatch clearly

### Outdated Command

List packages with available updates:

```bash
rn-dep-scanner outdated
```

Categorizes by update type:

```
🔴 Major Updates (3) - May include breaking changes
  react-native: 0.73.0 → 0.83.0
  react: 17.0.2 → 19.2.0

🟡 Minor Updates (2) - New features, backward compatible
  lodash: 4.17.20 → 4.17.21

🟢 Patch Updates (1) - Bug fixes only
  axios: 1.6.0 → 1.6.2
```

**Options:**
```bash
rn-dep-scanner outdated --major-only  # Only show major version updates
rn-dep-scanner outdated --json        # Machine-readable output
```

## Scanned Packages

The tool includes breaking change detection and compatibility analysis for:

### React Native Core
- `react-native` (0.71+)
- `react` (16.x, 17.x, 18.x, 19.x)

### Navigation & UI
- `@react-navigation/native` (6.x, 7.x)
- `react-native-screens` (3.x, 4.x)
- `react-native-gesture-handler` (2.x, 3.x)
- `react-native-safe-area-context` (4.x)

### Animations & Graphics
- `react-native-reanimated` (3.x, 4.x)
- `react-native-svg` (15.x+)
- `react-native-vision-camera` (3.x, 4.x)

### State Management & Backend
- `redux` (5.x+)
- `firebase` (10.x+)
- `expo` (50.x+)
- `expo-camera` (14.x+)

### Storage & Utils
- `@react-native-community/async-storage` (2.x+)
- `react-native-webview` (11.x+)
- `react-native-vector-icons` (10.x)
- `axios`, `lodash`, and more

All critical packages are scanned for version compatibility, breaking changes, and peer dependency conflicts.

## How It Works

### Check Command Flow

1. **Environment Detection** — Reads `package.json` to find React Native and React versions
2. **Lockfile Resolution** — Parses lock files (npm/yarn/pnpm/bun) to extract resolved versions
3. **Version Analysis** — Compares declared, installed, and latest versions
4. **Dependency Graph** — Builds tree to identify duplicates and conflicts
5. **Compatibility Checking** — Validates version compatibility using proper semantic versioning
6. **React ↔ RN Validation** — Ensures major version compatibility between React and React Native
7. **Breaking Change Detection** — Alerts on major version changes with breaking API modifications
8. **Deprecation Check** — Identifies superseded packages and suggests replacements
9. **Security Scanning** — Fetches vulnerability data from OSV.dev with local caching and fallback
10. **Report Generation** — Displays issues in readable format or JSON

### Outdated Command Flow

1. **Dependency Loading** — Reads all dependencies from package.json and lockfile
2. **Version Comparison** — Compares current vs latest available versions
3. **Categorization** — Classifies updates as major, minor, or patch
4. **Report Generation** — Displays updates grouped by type

## Security Data

As of v1.1.0, security vulnerability detection uses:
- **Primary**: OSV.dev API for real-time vulnerability data (authoritative, community-maintained)
- **Fallback**: Local database for offline mode (updated with major releases)
- **Caching**: 24-hour TTL cache stored in `~/.rn-scanner-cache/`

This ensures accurate, trustworthy vulnerability reporting instead of hardcoded CVE lists.

## Resolved vs Requested Versions

The scanner now distinguishes between:
- **Requested Version** — What's specified in `package.json` (e.g., `^1.2.3`)
- **Resolved Version** — What's actually installed per lockfile (e.g., `1.2.5`)

Security and compatibility checks operate on resolved versions for accuracy.

## Scripts

```bash
npm run dev      # Run in development mode
npm run build    # Build TypeScript to JavaScript
npm run test     # Run tests
npm run prepare  # Pre-publish build
```

## Development

Clone and install:

```bash
git clone <repo>
cd rn-dep-scanner
npm install
```

Run in development:

```bash
npm run dev check
```

Build:

```bash
npm run build
```

## License

MIT

## Contributing

Contributions welcome! Please submit pull requests with additional compatibility rules, breaking changes, or vulnerability data.
