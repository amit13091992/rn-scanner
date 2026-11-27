# ADR-0011: MCP server mode, hand-rolled over stdio

## Context

Coding agents (Claude Code, Cursor, Copilot) install packages and edit dependency manifests
without a human reading each change. GitHub's and Snyk's MCP servers already let an agent scan
for vulnerable dependencies, but none know React Native specifics (New Architecture support,
native toolchain baselines), and none check the failure mode specific to agents: installing a
hallucinated or typo'd package name that an attacker has since registered. `rn-dep-scanner mcp`
exposes this CLI's analyses as MCP tools.

## Decision

- `rn-dep-scanner mcp` serves MCP over stdio (newline-delimited JSON-RPC 2.0) with six
  read-only tools: `check_package` (new: pre-install safety verdict), `security_scan`,
  `check_dependencies`, `why`, `upgrade_readiness`, `doctor`. All but the first run the existing commands in `--json` mode and
  return exactly the JSON the CLI documents.
- The protocol layer (`src/mcp/protocol.ts`) is hand-rolled: initialize, ping, tools/list,
  tools/call only. It does not use `@modelcontextprotocol/sdk`.
- Tool calls are serialized: the command-backed tools capture `console.log`/`process.exit`
  process-wide (`utils/workspaceRun.ts`), so concurrent calls would interleave output.
- `check_package` verdicts are `ok | review | avoid | unknown`. `ok` requires every check to
  have run; a check that could not run is listed in `notChecked` and caps the verdict at
  `unknown` (ADR-0004). A registry 404 is distinguished from an unreachable registry — only the
  former is evidence the name does not exist.
- Tool arguments come from an agent and are treated as untrusted: `cwd` must be an existing
  directory and is only read; package names must match npm's naming rule before reaching a URL.
  No tool writes files, installs packages, or executes scanned code.

## Alternatives considered

- `@modelcontextprotocol/sdk` — rejected: 17 runtime dependencies (express, hono, jose, ajv,
  zod, ...) and ~4.5 MB unpacked, for a CLI packed at ~230 kB, against the minimal-dependency
  policy. Everything this server needs from the protocol is four methods.
- A separate `rn-preflight-mcp` package — rejected for now: duplicates release plumbing, and
  the tools are thin wrappers over this package's own analyzers.
- Streamable HTTP transport — rejected: a local, read-only analysis server needs no network
  listener (and the attack surface that comes with one).

## Consequences

- We own protocol conformance. Supported versions are listed in `SUPPORTED_PROTOCOL_VERSIONS`;
  the server answers with the client's version when it is listed, else the newest it knows,
  and the client decides whether to proceed. Capabilities beyond tools (resources, prompts,
  progress, cancellation) are not implemented; add them only with a concrete need.
- `check_package` calls the npm registry, the npm downloads API and OSV.dev per invocation; it
  degrades to `unknown` offline rather than failing.
- The tool names and the `check_package` result shape are a contract for agent configurations;
  renaming either is a breaking change.

- Lookalike-name detection compares against a hand-curated list (`data/popularPackages.ts`), not a
  download ranking, and is advisory: it warns only when real usage doesn't already show the
  package is established. A package missing from the list is simply not checked for imitators.

## Status

Accepted.
