# rn-dep-scanner

A comprehensive React Native dependency scanner that detects compatibility issues, breaking changes, and security vulnerabilities in your project.

## Features

- **Compatibility Analysis** — Detects version mismatches with React and React Native
- **Breaking Change Detection** — Alerts on major breaking changes in dependencies
- **Security Vulnerability Scanning** — Identifies known CVEs and security issues
- **Package Manager Detection** — Supports npm, yarn, pnpm, and bun
- **JSON Output** — Machine-readable output for CI/CD integration
- **Strict Mode** — Exit codes for automated quality gates

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

## Scanned Packages

The tool includes compatibility rules and breaking change detection for:

- `react-native` (0.71, 0.72, 0.73+)
- `react-native-reanimated` (3.x, 4.x)
- `react-native-screens` (3.x, 4.x)
- `react-native-gesture-handler` (2.x, 3.x)
- `react-native-safe-area-context` (4.x)
- `react-native-vector-icons` (10.x)
- `@react-navigation/native` (6.x, 7.x)
- `@react-native-async-storage/async-storage` (1.x)
- `react-native-vision-camera` (3.x, 4.x)
- `react-native-webview` (11.x)
- `axios`, `lodash`, and more

## How It Works

1. **Environment Detection** — Reads `package.json` to find React Native and React versions
2. **Dependency Analysis** — Scans all dependencies for issues
3. **Compatibility Checking** — Validates version compatibility using semantic versioning
4. **Breaking Change Detection** — Alerts on major version changes with breaking API modifications
5. **Security Scanning** — Checks against known CVE database
6. **Report Generation** — Displays issues in readable format or JSON

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
