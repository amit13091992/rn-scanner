# Security

## Reporting a vulnerability

If you find a security issue in `rn-dep-scanner` itself, please open a private report via
GitHub's "Report a vulnerability" flow on this repository rather than a public issue.

## About the Socket.dev "Supply Chain Risk" alerts

Automated scanners like [Socket.dev](https://socket.dev) flag packages that use certain
capabilities — network access, shell access, filesystem access, environment variable access —
as "supply chain risk," regardless of whether the usage is legitimate. `rn-dep-scanner` is a
dependency/environment scanner, so several of these are inherent to what it does, not evidence
of anything malicious. This section explains each one so a reviewer doesn't have to re-derive it.

| Alert | Why it's flagged | Where |
|---|---|---|
| **Network access** | `security`/`check` query [OSV.dev](https://osv.dev) to look up known vulnerabilities for your installed dependencies — the tool's core feature. Never sends your code, only package name + version. Opt out with `--no-security`. | `src/services/osvClient.ts` |
| **Shell access** (own code) | `doctor`/`native` shell out to `java -version` and `xcodebuild -version` to detect the installed JDK/Xcode version — there's no other way to read the host's actual installed toolchain version. Both use `spawnSync`/`execFileSync` with a fixed argument array (never a shell string), so there is no command-injection surface: user/project input never reaches these calls. | `src/detectors/android/java.ts`, `src/detectors/ios/xcode.ts` |
| **Shell access** (`commander` dependency) | `commander@15.0.0`'s own `lib/command.js` imports `node:child_process` — but only to support registering a subcommand as an *external executable file* (`program.command('name', 'path/to/file')`, two-argument form). This CLI never uses that form: every `program.command(...)` call here is the single-argument form paired with `.action(...)` (verified: `grep -n '\.command(' src/index.ts` shows only `'name'`/`'name <arg>'`, never a second path argument), so that code path in `commander` is unreachable through this tool. Flagged on the dependency's source, not on anything this CLI itself triggers. | `node_modules/commander/lib/command.js` (not this repo's code) |
| **Filesystem access** | The entire tool works by reading your `package.json`, lockfile, `node_modules`, and Android/iOS project config files. This is the product, not a side effect — see [Known Limitations](.claude/rules/known-limitations.md) for exactly what's read. | throughout `src/detectors/`, `src/parsers/` |
| **Environment variable access** | Standard terminal-capability detection (is this a TTY? is `NO_COLOR`/`FORCE_COLOR`/`CI` set?) from this project's `chalk`/`ora` dependencies, used only to decide whether to print colored/animated output — not read or transmitted anywhere. | transitive: `is-interactive`, `ora` |
| **URL strings** | Static string literals for documentation/migration-guide links shown in breaking-change output (e.g. `reactnative.dev/docs/upgrading`), and the OSV.dev API endpoint itself. Not runtime-constructed, not user data. | `src/analyzers/breakingChanges.ts`, `src/services/osvClient.ts` |
| **Debug access / AI-detected anomaly / Unmaintained / Minified code** | Flagged on a transitive dependency at the time of a specific published version's scan, not on `rn-dep-scanner`'s own code. `npm audit --omit=dev` reports 0 known vulnerabilities, and all four direct runtime dependencies (`chalk`, `commander`, `ora`, `semver`) are kept pinned to their latest release — see below. | transitive tree |

No dependency here is ever executed dynamically (`eval`, `new Function`, `vm.*` are not used
anywhere in this codebase — verified by `grep -rn "new Function\|vm\.\|Reflect\." src/`).

## Dependency policy

Runtime dependencies are kept minimal and current on purpose:

```
chalk       ^6.0.0
commander   ^15.0.0
ora         ^9.4.1
semver      ^7.8.5
```

Each is a widely-used, actively maintained package with no known vulnerabilities
(`npm audit --omit=dev`). New runtime dependencies require a stated reason per this repo's
`.claude/rules/dependency-policy.md`.

### On Socket's "optimized override available" suggestion

Socket.dev separately suggests swapping some transitive dependencies (currently
`is-interactive`, `is-unicode-supported` — pulled in via `ora`) for its own
`@socketregistry/*` published forks, via an npm `overrides`/`resolutions` field. This is a
maintenance suggestion from Socket's own package registry, not a vulnerability fix — both
original packages have 0 known vulnerabilities and are actively maintained by their upstream
author. Deliberately **not** applied here: silently repointing a dependency's resolution to a
different publisher's fork is exactly the kind of supply-chain decision that should be made
explicitly, not automatically in response to a promotional nudge from the same scanner that's
recommending it. If you want this for your own fork, add an `overrides` field to `package.json`
naming the exact `@socketregistry/*` package/version — it isn't something this project applies
on your behalf.
