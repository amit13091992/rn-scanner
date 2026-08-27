#!/usr/bin/env node

import { Command } from 'commander';
import { checkCommand } from './commands/check.js';

const program = new Command();

program
  .name('rn-scanner')
  .description('React Native dependency scanner - compatibility, breaking changes & security vulnerabilities')
  .version('1.0.0');

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

program.parse();
