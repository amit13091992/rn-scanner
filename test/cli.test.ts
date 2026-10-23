import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// index.ts's argv-parsing/command-dispatch logic runs at module load time and can't be
// exercised by importing command functions directly (every other test file's approach) — it
// has to be invoked as a real subprocess against the built dist/index.js, per this repo's
// standard build-then-test workflow (CLAUDE.md's Verification section).
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'dist', 'index.js');

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf-8' });
    return { stdout, stderr: '', code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.status ?? 1 };
  }
}

test('CLI - a misspelled command name reports "Unknown command", not a confusing commander argument error', () => {
  const { stdout, code } = run(['frobnicate']);
  assert.equal(code, 1);
  assert.match(stdout, /Unknown command: "frobnicate"/);
  assert.doesNotMatch(stdout, /too many arguments for 'check'/);
});

test('CLI - a known command name is unaffected by the unknown-command guard', () => {
  const { stdout, code } = run(['--version']);
  assert.equal(code, 0);
  assert.match(stdout, /^\d+\.\d+\.\d+/);
});

test('CLI - bare invocation still runs the default `check` command', () => {
  const { stdout, code } = run(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /RN Deps Scanner|rn-dep-scanner/i);
});
