#!/usr/bin/env node

import { Command } from 'commander';
import { checkCommand } from './commands/check.js';
import { outdatedCommand } from './commands/outdated.js';

const program = new Command();

program
  .name('rn-dep-scanner')
  .description('React Native dependency scanner - compatibility, breaking changes & security vulnerabilities')
  .version('1.1.0');

program
  .command('check', { isDefault: true })
  .description('Check React Native dependency compatibility')
  .option('--json', 'Output as JSON')
  .option('--strict', 'Exit with code 1 if there are errors')
  .option('--cwd <path>', 'Working directory')
  .action(async (options) => {
    await checkCommand({
      json: options.json || false,
      strict: options.strict || false,
      cwd: options.cwd || process.cwd(),
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

program.parse();
