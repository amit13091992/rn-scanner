import chalk from 'chalk';

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
