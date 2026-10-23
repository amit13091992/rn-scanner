#!/usr/bin/env node

import { createRequire } from 'module';
import { Command } from 'commander';
import { checkCommand } from './commands/check.js';
import { outdatedCommand } from './commands/outdated.js';
import { doctorCommand } from './commands/doctor.js';
import { whyCommand } from './commands/why.js';
import { securityCommand } from './commands/security.js';
import { unusedCommand } from './commands/unused.js';
import { whyNotCommand } from './commands/whyNot.js';
import { impactCommand } from './commands/impact.js';
import { licensesCommand } from './commands/licenses.js';
import { sbomCommand } from './commands/sbom.js';
import { diffCommand } from './commands/diff.js';
import { legacyApisCommand } from './commands/legacyApis.js';
import { aiExposureCommand } from './commands/aiExposure.js';
import { renovateConfigCommand } from './commands/renovateConfig.js';
import { bundleCommand } from './commands/bundle.js';
import { policyCommand } from './commands/policy.js';
import { baselineCommand } from './commands/baseline.js';
import { reportCommand } from './commands/report.js';
import { watchCommand } from './commands/watch.js';
import { accessibilityCommand } from './commands/accessibility.js';
import { architectureCommand } from './commands/architecture.js';
import { nativeCommand } from './commands/native.js';
import { pageSize16kCommand } from './commands/pageSize16k.js';
import { graphCommand } from './commands/graph.js';
import { treeCommand } from './commands/tree.js';
import { compareRnCommand } from './commands/compareRn.js';
import { upgradeCommand } from './commands/upgrade.js';
import { printError } from './utils/terminal.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

// Last-resort net for errors that escape every command's own try/catch (e.g. a bug thrown
// before a command handler runs, or an unhandled rejection from a dangling promise) — without
// this, such an error surfaces as a raw Node stack trace instead of a clean CLI message.
process.on('uncaughtException', (error) => {
  printError(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  printError(`Unexpected error: ${reason instanceof Error ? reason.message : String(reason)}`);
  process.exit(1);
});

// Commands call process.exit(1) right after printing (e.g. `security --json` on findings). When
// stdout is a pipe, a large payload is still buffered at that point and an immediate exit
// truncates it (observed at 64KB), corrupting piped JSON — so wait for the buffer to drain.
const exitNow = process.exit.bind(process) as (code?: number) => never;
process.exit = ((code?: number) => {
  if (code !== undefined) process.exitCode = code;
  if (process.stdout.writableLength === 0) return exitNow(code);
  process.stdout.write('', () => exitNow(code));
  return undefined as never;
}) as typeof process.exit;

const program = new Command();

program
  .name('rn-dep-scanner')
  .description('React Native dependency scanner - compatibility, breaking changes & security vulnerabilities')
  .version(version)
  .option('--offline', 'Make no network calls (OSV.dev, npm registry); network-backed sections report as skipped')
  .option('--timeout <ms>', 'Per-request network timeout in milliseconds (default 8000)')
  .hook('preAction', () => {
    const globals = program.opts<{ offline?: boolean; timeout?: string }>();
    if (globals.offline) process.env.RN_DEP_SCANNER_OFFLINE = '1';
    if (globals.timeout) process.env.RN_DEP_SCANNER_TIMEOUT_MS = globals.timeout;
  });

program
  .command('check', { isDefault: true })
  .description('Check React Native dependency compatibility')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--strict', 'Exit with code 1 if there are errors')
  .option('--cwd <path>', 'Working directory')
  .option('--no-security', 'Skip checking for known vulnerabilities via OSV.dev (enabled by default, requires network)')
  .option('--profile', 'Print a per-step timing breakdown of the scan itself')
  .option('--verbose', 'List every security advisory instead of one grouped block per package')
  .option('--all-workspaces', 'Check every workspace package in the monorepo, not just --cwd, and aggregate the results')
  .action(async (options) => {
    await checkCommand({
      verbose: options.verbose || false,
      json: options.json || false,
      html: options.html || false,
      strict: options.strict || false,
      cwd: options.cwd || process.cwd(),
      security: options.security !== false,
      profile: options.profile || false,
      allWorkspaces: options.allWorkspaces || false,
    });
  });

program
  .command('outdated')
  .description('List packages with available updates')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--major-only', 'Only show major version updates')
  .option('--recommend', 'Resolve a React-Native-compatible recommended version per package, not just npm\'s absolute latest')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await outdatedCommand({
      json: options.json || false,
      html: options.html || false,
      majorOnly: options.majorOnly || false,
      recommend: options.recommend || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('doctor')
  .description('Check React Native environment health (Hermes, native toolchain)')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .option('--ipa <path>', 'Path to a built .ipa/.xcarchive to check for dSYM presence')
  .option('--profile', 'Print a per-step timing breakdown of the scan itself')
  .option('--all-workspaces', 'Check every workspace package in the monorepo, not just --cwd, and aggregate the results')
  .action(async (options) => {
    await doctorCommand({
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
      ipa: options.ipa || undefined,
      profile: options.profile || false,
      allWorkspaces: options.allWorkspaces || false,
    });
  });

program
  .command('why <package>')
  .description('Explain why a package is installed')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .option('--all-workspaces', 'Trace the package across every workspace package in the monorepo, not just --cwd')
  .action(async (packageName, options) => {
    await whyCommand(packageName, {
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
      allWorkspaces: options.allWorkspaces || false,
    });
  });

program
  .command('security')
  .description('Scan direct and transitive dependencies for known vulnerabilities (via OSV.dev)')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .option('--all-workspaces', 'Scan every workspace package in the monorepo, not just --cwd, and aggregate the results')
  .option('--verbose', 'List every advisory instead of one grouped block per package')
  .option('--summary', 'Only severity counts and one line per affected package')
  .option('--fail-on <severity>', 'Exit 1 when a finding at or above this severity exists: critical, high (default), moderate, low, none')
  .action(async (options) => {
    await securityCommand({
      verbose: options.verbose || false,
      summary: options.summary || false,
      ...(options.failOn ? { failOn: options.failOn } : {}),
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
      allWorkspaces: options.allWorkspaces || false,
    });
  });

program
  .command('why-not <package> <version>')
  .description('Explain why a specific version of a package cannot be installed (peer/version conflicts)')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .action(async (packageName, version, options) => {
    await whyNotCommand(packageName, version, {
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('impact <package> <version>')
  .description('Assess the impact of upgrading a package to a specific version')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .action(async (packageName, version, options) => {
    await impactCommand(packageName, version, {
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('unused')
  .description('List declared dependencies with no detected import in project source (heuristic)')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await unusedCommand({
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('licenses')
  .description('Report each dependency\'s license, optionally flagging a configured denylist')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .option('--all-workspaces', 'Report against every workspace package in the monorepo, not just --cwd')
  .option('--verbose', 'List every package name under each license instead of counts only')
  .action(async (options) => {
    await licensesCommand({
      verbose: options.verbose || false,
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
      allWorkspaces: options.allWorkspaces || false,
    });
  });

program
  .command('renovate-config')
  .description('Generate a starter Renovate config that groups native modules and React Native core packages, and flags New Architecture review-worthy updates')
  .option('--out <path>', 'Write the config to this file instead of stdout')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await renovateConfigCommand({
      cwd: options.cwd || process.cwd(),
      out: options.out,
    });
  });

program
  .command('sbom')
  .description('Export a CycloneDX Software Bill of Materials (JSON, or HTML with --html) to stdout')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await sbomCommand({
      cwd: options.cwd || process.cwd(),
      html: options.html || false,
    });
  });

program
  .command('diff')
  .description('Compare dependency graphs between two project directories, flagging newly-introduced vulnerabilities')
  .requiredOption('--from <path>', 'Directory to diff from')
  .requiredOption('--to <path>', 'Directory to diff to')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .action(async (options) => {
    await diffCommand({
      json: options.json || false,
      html: options.html || false,
      from: options.from,
      to: options.to,
    });
  });

program
  .command('legacy-apis')
  .description('Detect usage of legacy/removed React Native core APIs, with suggested replacements')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await legacyApisCommand({
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('a11y')
  .description('Flag interactive elements (Pressable, Touchable*, Image, TextInput, ...) missing accessibility labels')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--strict', 'Exit with code 1 if a high-confidence missing label is found')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await accessibilityCommand({
      json: options.json || false,
      html: options.html || false,
      strict: options.strict || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('ai-exposure')
  .description('Detect direct client-side calls to AI provider SDKs and AI-provider-key-shaped literals in source')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await aiExposureCommand({
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('bundle')
  .description('Report each direct dependency\'s on-disk install size, largest first (a bundle-weight approximation)')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await bundleCommand({
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('policy')
  .description('Evaluate the project against .rn-dep-scanner.json org-policy rules (bannedPackages, licenseDenylist, maxVulnerabilitySeverity)')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .option('--all-workspaces', 'Evaluate every workspace package in the monorepo, not just --cwd')
  .option('--init', 'Create a starter .rn-dep-scanner.json with example policy rules, then exit')
  .action(async (options) => {
    await policyCommand({
      init: options.init || false,
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
      allWorkspaces: options.allWorkspaces || false,
    });
  });

program
  .command('baseline')
  .description('Snapshot current security findings, or report only findings new since the last snapshot')
  .option('--create', 'Create/overwrite the baseline snapshot instead of checking against it')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await baselineCommand({
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
      create: options.create || false,
    });
  });

program
  .command('report')
  .description('Render a dependency-health report (Markdown or HTML)')
  .option('--format <format>', 'Output format: md or html', 'md')
  .option('--out <path>', 'Write to a file instead of stdout')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await reportCommand({
      cwd: options.cwd || process.cwd(),
      format: options.format === 'html' ? 'html' : 'md',
      out: options.out,
    });
  });

program
  .command('watch')
  .description('Run check repeatedly on an interval until interrupted')
  .option('--interval <seconds>', 'Seconds between scans (default 300)', (v) => parseInt(v, 10))
  .option('--once', 'Run a single scan and exit')
  .option('--iterations <n>', 'Stop automatically after n scans (default: run until Ctrl+C)', (v) => parseInt(v, 10))
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await watchCommand({
      cwd: options.cwd || process.cwd(),
      json: options.json || false,
      html: options.html || false,
      interval: options.interval,
      iterations: options.once ? 1 : options.iterations,
    });
  });

program
  .command('architecture')
  .description('Standalone New Architecture (Fabric/TurboModules) compatibility report')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await architectureCommand({
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('native')
  .description('Standalone Android + iOS native toolchain report')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await nativeCommand({
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('16kb')
  .description('Standalone Android 16KB page-size alignment report')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await pageSize16kCommand({
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('graph')
  .description('Export the raw dependency graph (JSON or Graphviz DOT)')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--dot', 'Output as Graphviz DOT')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await graphCommand({
      json: options.json || false,
      html: options.html || false,
      dot: options.dot || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('tree [package]')
  .description('Print the dependency tree, optionally rooted at a package')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--duplicates', 'Only show branches containing duplicate package versions')
  .option('--cwd <path>', 'Working directory')
  .option('--all-workspaces', 'Print the tree for every workspace package in the monorepo, not just --cwd')
  .action(async (packageName, options) => {
    await treeCommand(packageName, {
      json: options.json || false,
      html: options.html || false,
      duplicatesOnly: options.duplicates || false,
      cwd: options.cwd || process.cwd(),
      allWorkspaces: options.allWorkspaces || false,
    });
  });

program
  .command('compare-rn <from> <to>')
  .description('Compare native toolchain requirements between two React Native versions')
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .action(async (from, to, options) => {
    await compareRnCommand(from, to, {
      json: options.json || false,
      html: options.html || false,
    });
  });

program
  .command('upgrade')
  .description('Assess upgrade readiness to a target React Native version')
  .option('--to <version>', 'Target React Native version')
  .option('--latest', "Resolve the target version from npm's react-native `latest` dist-tag instead of --to")
  .option('--json', 'Output as JSON')
  .option('--html [path]', 'Output as HTML (stdout, or a file if a path is given)')
  .option('--cwd <path>', 'Working directory')
  .option('--all-workspaces', 'Assess every workspace package in the monorepo, not just --cwd, and aggregate the results')
  .action(async (options) => {
    const assumeLatest = !options.to && !options.latest;
    if (assumeLatest && !options.json && !options.html) {
      console.error('No target given (--to <version> or --latest) — assuming --latest.');
    }
    await upgradeCommand(options.to, {
      json: options.json || false,
      html: options.html || false,
      cwd: options.cwd || process.cwd(),
      allWorkspaces: options.allWorkspaces || false,
      latest: options.latest || assumeLatest,
    });
  });

// `check` is registered with { isDefault: true } so bare `rn-dep-scanner [options]` runs it —
// but that same default-command wiring means an unrecognized subcommand name (a typo) is
// otherwise silently routed to `check` as an unexpected positional argument, producing a
// confusing "too many arguments for 'check'" error instead of a clear "unknown command".
// Intercept that case here, before commander's own parsing, with a proper error message.
const firstArg = process.argv[2];
if (firstArg && !firstArg.startsWith('-') && firstArg !== 'help') {
  const knownCommands = program.commands.map((cmd) => cmd.name());
  if (!knownCommands.includes(firstArg)) {
    printError(`Unknown command: "${firstArg}"`);
    console.log(`\nRun 'npx rn-dep-scanner --help' to see the full command list, or 'npx rn-dep-scanner check' for the default dependency-compatibility scan.`);
    process.exit(1);
  }
}

program.parse();
