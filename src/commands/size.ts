import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { measureModuleSizes } from '../detectors/bundleStats.js';
import { detectHermesCompilerVersion, detectMetroVersion, readHbcBytecodeVersion } from '../detectors/bundleToolchain.js';
import { diffBundleSnapshots } from '../analyzers/bundleSizeDiff.js';
import { loadConfig } from '../utils/config.js';
import { printHeader, printSuccess, printWarning, printError, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';
import { BUNDLE_SNAPSHOT_SCHEMA_VERSION, type BundleBudget, type BundlePlatform, type BundleSnapshot } from '../types/bundleSize.js';

export interface SizeMeasureOptions {
  cwd?: string;
  bundle: string;
  sourceMap: string;
  hbc?: string;
  platform: BundlePlatform;
  out?: string;
  commit?: string;
  metroVersion?: string;
  hermesVersion?: string;
  json?: boolean;
}

export interface SizeDiffOptions {
  cwd?: string;
  base: string;
  head: string;
  budget?: string;
  json?: boolean;
  html?: HtmlOption;
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`;
const signed = (bytes: number): string => `${bytes >= 0 ? '+' : '-'}${kb(Math.abs(bytes))}`;

/** Reads already-built artifacts only — never invokes Metro, Expo or hermesc (ADR-0010). */
export function sizeMeasureCommand(options: SizeMeasureOptions): void {
  const cwd = options.cwd || process.cwd();
  try {
    const bundleText = readFileSync(resolve(cwd, options.bundle), 'utf8');
    const map: unknown = JSON.parse(readFileSync(resolve(cwd, options.sourceMap), 'utf8'));
    const measured = measureModuleSizes(bundleText, map, cwd);
    if (!measured) {
      printError('Source map is not a supported v3 map (plain or Metro index map) or is malformed');
      process.exit(1);
    }
    let hermesVersion = options.hermesVersion ?? null;
    if (options.hbc) {
      const bytecodeVersion = readHbcBytecodeVersion(resolve(cwd, options.hbc));
      if (bytecodeVersion === null) {
        printError(`${options.hbc} is not a Hermes bytecode file (bad magic number)`);
        process.exit(1);
      }
      // The bytecode format version is what actually decides whether two .hbc sizes are comparable,
      // so it is the fallback when hermes-compiler isn't installed.
      hermesVersion ??= detectHermesCompilerVersion(cwd) ?? `bytecode-v${bytecodeVersion}`;
    }
    const snapshot: BundleSnapshot = {
      schemaVersion: BUNDLE_SNAPSHOT_SCHEMA_VERSION,
      platform: options.platform,
      commitSha: options.commit ?? null,
      toolchain: { metroVersion: options.metroVersion ?? detectMetroVersion(cwd), hermesVersion },
      totals: {
        jsBytes: measured.jsBytes,
        hbcBytes: options.hbc ? statSync(resolve(cwd, options.hbc)).size : null,
        unmappedBytes: measured.unmappedBytes,
      },
      modules: measured.modules,
    };
    const text = JSON.stringify(snapshot, null, 2);
    if (options.out) writeFileSync(resolve(cwd, options.out), text + '\n');
    if (options.json || !options.out) console.log(text);
    else printSuccess(`Wrote ${options.out} (${snapshot.modules.length} modules, ${kb(snapshot.totals.jsBytes)} JS)`);
  } catch (err) {
    printError(`size measure failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function readSnapshot(path: string): BundleSnapshot {
  return JSON.parse(readFileSync(path, 'utf8')) as BundleSnapshot;
}

export function sizeDiffCommand(options: SizeDiffOptions): void {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;
  let exitCode = 0;
  try {
    const base = readSnapshot(resolve(cwd, options.base));
    const head = readSnapshot(resolve(cwd, options.head));
    let budget: BundleBudget = loadConfig(cwd).config.sizeBudget ?? {};
    if (options.budget) budget = JSON.parse(readFileSync(resolve(cwd, options.budget), 'utf8')) as BundleBudget;
    const result = diffBundleSnapshots(base, head, budget);
    if (result.status !== 'ok') exitCode = 1;

    if (jsonMode) {
      emitStructuredOutput(result, 'Bundle Size Diff', options);
    } else if (result.status === 'not-comparable') {
      printError(`Snapshots are not comparable: ${result.reason}`);
      printInfo('Re-measure the base on the current toolchain instead of comparing unlike data.');
    } else {
      printHeader('Bundle Size Diff');
      const t = result.totals;
      if (t) {
        printInfo(`JS: ${kb(t.js.base)} → ${kb(t.js.head)} (${signed(t.js.delta)})`);
        printInfo(t.hbc ? `Hermes bytecode: ${kb(t.hbc.base)} → ${kb(t.hbc.head)} (${signed(t.hbc.delta)})` : 'Hermes bytecode: not measured on both sides');
      }
      for (const m of result.added.slice(0, 10)) printInfo(`+ ${m.id}  ${signed(m.delta)}`);
      for (const m of result.grown.slice(0, 10)) printInfo(`↑ ${m.id}  ${signed(m.delta)}`);
      for (const w of result.warnings) printWarning(w);
      for (const n of result.notChecked) printWarning(`Not checked — ${n}`);
      for (const v of result.violations) printError(`Over budget: ${v.kind}${v.module ? ` ${v.module}` : ''} ${v.actualKb.toFixed(1)} KiB > ${v.limitKb} KiB`);
      if (result.status === 'ok') printSuccess('Within budget');
    }
  } catch (err) {
    printError(`size diff failed: ${err instanceof Error ? err.message : String(err)}`);
    exitCode = 1;
  }
  if (exitCode !== 0) process.exit(exitCode);
}
