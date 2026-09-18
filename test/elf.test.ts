import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseElfAlignment } from '../src/utils/elf.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, '..', 'test-fixtures', 'elf');

function readFixture(name: string): Buffer {
  return readFileSync(join(fixtureDir, name));
}

test('parseElfAlignment - reports a 16KB-aligned PT_LOAD segment as aligned', () => {
  const result = parseElfAlignment(readFixture('aligned.so'));

  assert.ok(result);
  assert.equal(result!.bitness, 64);
  assert.equal(result!.maxLoadAlign, 0x4000);
  assert.equal(result!.is16kAligned, true);
});

test('parseElfAlignment - reports a 4KB-aligned PT_LOAD segment as unaligned', () => {
  const result = parseElfAlignment(readFixture('unaligned.so'));

  assert.ok(result);
  assert.equal(result!.maxLoadAlign, 0x1000);
  assert.equal(result!.is16kAligned, false);
});

test('parseElfAlignment - returns null for a truncated ELF file instead of throwing', () => {
  const result = parseElfAlignment(readFixture('truncated.so'));

  assert.equal(result, null);
});

test('parseElfAlignment - returns null for a non-ELF file', () => {
  const result = parseElfAlignment(readFixture('not-elf.so'));

  assert.equal(result, null);
});

test('parseElfAlignment - returns null for an empty buffer', () => {
  const result = parseElfAlignment(Buffer.alloc(0));

  assert.equal(result, null);
});
