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

const program = new Command();

program
  .name('rn-dep-scanner')
  .description('React Native dependency scanner - compatibility, breaking changes & security vulnerabilities')
  .version(version);

program
  .command('check', { isDefault: true })
  .description('Check React Native dependency compatibility')
  .option('--json', 'Output as JSON')
  .option('--strict', 'Exit with code 1 if there are errors')
  .option('--cwd <path>', 'Working directory')
  .option('--no-security', 'Skip checking for known vulnerabilities via OSV.dev (enabled by default, requires network)')
  .option('--profile', 'Print a per-step timing breakdown of the scan itself')
  .action(async (options) => {
    await checkCommand({
      json: options.json || false,
      strict: options.strict || false,
      cwd: options.cwd || process.cwd(),
      security: options.security !== false,
      profile: options.profile || false,
    });
  });

program
  .command('outdated')
  .description('List packages with available updates')
  .option('--json', 'Output as JSON')
  .option('--major-only', 'Only show major version updates')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await outdatedCommand({
      json: options.json || false,
      majorOnly: options.majorOnly || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('doctor')
  .description('Check React Native environment health (Hermes, native toolchain)')
  .option('--json', 'Output as JSON')
  .option('--cwd <path>', 'Working directory')
  .option('--ipa <path>', 'Path to a built .ipa/.xcarchive to check for dSYM presence')
  .option('--profile', 'Print a per-step timing breakdown of the scan itself')
  .action(async (options) => {
    await doctorCommand({
      json: options.json || false,
      cwd: options.cwd || process.cwd(),
      ipa: options.ipa || undefined,
      profile: options.profile || false,
    });
  });

program
  .command('why <package>')
  .description('Explain why a package is installed')
  .option('--json', 'Output as JSON')
  .option('--cwd <path>', 'Working directory')
  .action(async (packageName, options) => {
    await whyCommand(packageName, {
      json: options.json || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('security')
  .description('Scan direct and transitive dependencies for known vulnerabilities (via OSV.dev)')
  .option('--json', 'Output as JSON')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await securityCommand({
      json: options.json || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('why-not <package> <version>')
  .description('Explain why a specific version of a package cannot be installed (peer/version conflicts)')
  .option('--json', 'Output as JSON')
  .option('--cwd <path>', 'Working directory')
  .action(async (packageName, version, options) => {
    await whyNotCommand(packageName, version, {
      json: options.json || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('impact <package> <version>')
  .description('Assess the impact of upgrading a package to a specific version')
  .option('--json', 'Output as JSON')
  .option('--cwd <path>', 'Working directory')
  .action(async (packageName, version, options) => {
    await impactCommand(packageName, version, {
      json: options.json || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('unused')
  .description('List declared dependencies with no detected import in project source (heuristic)')
  .option('--json', 'Output as JSON')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await unusedCommand({
      json: options.json || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('licenses')
  .description('Report each dependency\'s license, optionally flagging a configured denylist')
  .option('--json', 'Output as JSON')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await licensesCommand({
      json: options.json || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('sbom')
  .description('Export a CycloneDX Software Bill of Materials (JSON) to stdout')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await sbomCommand({
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('diff')
  .description('Compare dependency graphs between two project directories, flagging newly-introduced vulnerabilities')
  .requiredOption('--from <path>', 'Directory to diff from')
  .requiredOption('--to <path>', 'Directory to diff to')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await diffCommand({
      json: options.json || false,
      from: options.from,
      to: options.to,
    });
  });

program
  .command('tree [package]')
  .description('Print the dependency tree, optionally rooted at a package')
  .option('--json', 'Output as JSON')
  .option('--duplicates', 'Only show branches containing duplicate package versions')
  .option('--cwd <path>', 'Working directory')
  .action(async (packageName, options) => {
    await treeCommand(packageName, {
      json: options.json || false,
      duplicatesOnly: options.duplicates || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program
  .command('compare-rn <from> <to>')
  .description('Compare native toolchain requirements between two React Native versions')
  .option('--json', 'Output as JSON')
  .action(async (from, to, options) => {
    await compareRnCommand(from, to, {
      json: options.json || false,
    });
  });

program
  .command('upgrade')
  .description('Assess upgrade readiness to a target React Native version')
  .requiredOption('--to <version>', 'Target React Native version')
  .option('--json', 'Output as JSON')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await upgradeCommand(options.to, {
      json: options.json || false,
      cwd: options.cwd || process.cwd(),
    });
  });

program.parse();
