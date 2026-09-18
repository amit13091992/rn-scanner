import chalk from 'chalk';
import { computeHealthScore, type HealthScoreInput } from './healthScore.js';
import type { ProfileEntry } from './profiler.js';

export interface VersionInfo {
  declared?: string;
  installed?: string;
  latest?: string;
}

export type HealthScoreBreakdown = HealthScoreInput;

export function printHeader(title: string): void {
  const line = '━'.repeat(50);
  console.log('\n' + chalk.cyan(line));
  console.log(chalk.cyan.bold(`   ${title}`));
  console.log(chalk.cyan(line) + '\n');
}

export function printSection(title: string): void {
  console.log(chalk.bold.cyan(`\n${title}`));
  console.log(chalk.cyan('─'.repeat(title.length)));
}

export function printSuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

export function printWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}

export function printError(message: string): void {
  console.log(chalk.red(`✗ ${message}`));
}

export function printInfo(message: string): void {
  console.log(chalk.blue(`ℹ ${message}`));
}

export function printProfile(entries: ProfileEntry[], totalMs: number): void {
  printSection('Performance Profile (--profile)');
  entries.forEach((entry) => {
    console.log(`  ${entry.durationMs.toFixed(1).padStart(7)}ms  ${entry.label}`);
  });
  console.log(chalk.gray(`  ${'─'.repeat(30)}`));
  console.log(`  ${totalMs.toFixed(1).padStart(7)}ms  total (profiled steps)`);
}

export function printVersionComparison(
  packageName: string,
  versions: VersionInfo
): void {
  const parts: string[] = [];
  if (versions.declared) parts.push(`declared: ${chalk.gray(versions.declared)}`);
  if (versions.installed) parts.push(`installed: ${chalk.blue(versions.installed)}`);
  if (versions.latest) parts.push(`latest: ${chalk.cyan(versions.latest)}`);

  console.log(`  ${packageName}: ${parts.join(' → ')}`);
}

export function printHealthScore(breakdown: HealthScoreBreakdown): void {
  const { score, analyzed, total, lowCoverage } = computeHealthScore(breakdown);

  const scoreColor = score >= 80 ? chalk.green : score >= 60 ? chalk.yellow : chalk.red;
  console.log(`\n${scoreColor.bold(`Health Score: ${score}/100`)} ${chalk.gray(`(based on ${analyzed} of ${total} dependencies with known compatibility rules)`)}`);
  if (lowCoverage) {
    console.log(chalk.gray('  ℹ Most dependencies have no compatibility rules yet — this score reflects only the few that were checked, not overall project health'));
  }

  console.log(chalk.gray('  ├─ ✓ Compatible:    ') + chalk.green(breakdown.compatible));
  if (breakdown.warnings > 0) {
    console.log(chalk.gray('  ├─ ⚠ Warnings:      ') + chalk.yellow(breakdown.warnings));
  }
  if (breakdown.errors > 0) {
    console.log(chalk.gray('  ├─ ✗ Errors:        ') + chalk.red(breakdown.errors));
  }
  if (breakdown.notChecked > 0) {
    console.log(chalk.gray('  └─ ? Not Checked:   ') + chalk.gray(breakdown.notChecked));
  }
}

export function printTable(
  headers: string[],
  rows: Array<Record<string, string>>
): void {
  if (rows.length === 0) {
    console.log(chalk.gray('  No data to display'));
    return;
  }

  const colWidths = headers.map((header) => {
    const maxRowWidth = Math.max(
      ...rows.map((row) => String(row[header] || '').length)
    );
    return Math.max(header.length, maxRowWidth);
  });

  const headerRow = headers
    .map((h, i) => h.padEnd(colWidths[i]))
    .join(' │ ');
  const separatorRow = colWidths.map((w) => '─'.repeat(w)).join('─┼─');

  console.log(chalk.cyan('┌' + separatorRow.replace(/─/g, '─').replace(/┼/g, '┬') + '┐'));
  console.log(chalk.cyan('│ ' + headerRow + ' │'));
  console.log(chalk.cyan('├' + separatorRow.replace(/─/g, '─').replace(/┼/g, '┼') + '┤'));

  rows.forEach((row) => {
    const rowStr = headers
      .map((h, i) => String(row[h] || '').padEnd(colWidths[i]))
      .join(' │ ');
    console.log(chalk.gray('│ ' + rowStr + ' │'));
  });

  console.log(chalk.cyan('└' + separatorRow.replace(/─/g, '─').replace(/┼/g, '┴') + '┘'));
}

export function printSummary(
  total: number,
  compatible: number,
  warnings: number,
  errors: number
): void {
  console.log('\n' + chalk.gray('─'.repeat(50)));
  console.log(`${total} dependencies checked`);
  console.log(chalk.green(`${compatible} compatible`));
  if (warnings > 0) console.log(chalk.yellow(`${warnings} warnings`));
  if (errors > 0) console.log(chalk.red(`${errors} errors`));

  const healthScore = Math.round((compatible / total) * 100);
  console.log(`\nHealth Score: ${healthScore}/100`);
}
