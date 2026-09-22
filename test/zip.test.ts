import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listZipEntries, readZipEntry } from '../src/utils/zip.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, '..', 'test-fixtures', 'ipa');

function readFixture(name: string): Buffer {
  return readFileSync(join(fixtureDir, name));
}

test('listZipEntries - lists all entries in a valid zip', () => {
  const entries = listZipEntries(readFixture('with-dsym.ipa'));

  assert.ok(entries);
  assert.equal(entries!.length, 3);
  assert.ok(entries!.some((e) => e.name === 'Payload/MyApp.app/MyApp'));
  assert.ok(entries!.some((e) => e.name === 'MyApp.app.dSYM/Contents/Resources/DWARF/MyApp'));
});

test('listZipEntries - returns null for a non-zip file', () => {
  const entries = listZipEntries(readFixture('not-a-zip.ipa'));

  assert.equal(entries, null);
});

test('listZipEntries - returns null for an empty buffer', () => {
  const entries = listZipEntries(Buffer.alloc(0));

  assert.equal(entries, null);
});

test('readZipEntry - extracts a stored (uncompressed) entry\'s exact bytes', () => {
  const buffer = readFixture('with-dsym.ipa');
  const entries = listZipEntries(buffer);
  assert.ok(entries);
  const entry = entries!.find((e) => e.name === 'Payload/MyApp.app/Info.plist');
  assert.ok(entry);

  const data = readZipEntry(buffer, entry!);
  assert.ok(data);
  assert.equal(data!.length, 0); // the ipa fixtures use empty placeholder content
});

test('readZipEntry - returns null for an entry missing zip metadata', () => {
  const data = readZipEntry(Buffer.alloc(0), { name: 'x' });
  assert.equal(data, null);
});
