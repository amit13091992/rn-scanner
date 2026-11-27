import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import { sbomCommand } from '../src/commands/sbom.js';

// The official CycloneDX 1.6 JSON schemas (Apache-2.0), vendored from the CycloneDX/specification
// 1.6 tag so a malformed document — e.g. a non-SPDX license emitted as `id`, which this once did —
// fails here rather than in a consumer's validator.
const schemaDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cyclonedx');
const readSchema = (file: string): object => JSON.parse(readFileSync(join(schemaDir, file), 'utf-8'));

function validator(): (doc: unknown) => string[] {
  // `format` keywords (uri, date-time, idn-email) need ajv-formats; structural validation is the point here.
  const ajv = new Ajv({ schemaId: 'auto', unknownFormats: 'ignore', allErrors: true });
  ajv.addSchema(readSchema('spdx.schema.json'));
  ajv.addSchema(readSchema('jsf-0.82.schema.json'));
  const validate = ajv.compile(readSchema('bom-1.6.schema.json'));
  return (doc) => (validate(doc) ? [] : (validate.errors ?? []).map((e) => `${e.dataPath} ${e.message}`));
}

function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  let output = '';
  console.log = (msg?: unknown) => {
    output += `${String(msg)}\n`;
  };
  return fn().then(() => output).finally(() => {
    console.log = original;
  });
}

function writeProject(dir: string): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', version: '1.2.3', dependencies: { foo: '1.0.0', odd: '1.0.0' }, devDependencies: { '@scope/dev-tool': '2.0.0' } }));
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'app', dependencies: { foo: '1.0.0', odd: '1.0.0' }, devDependencies: { '@scope/dev-tool': '2.0.0' } },
        'node_modules/foo': { version: '1.0.0', integrity: `sha512-${createHash('sha512').update('foo').digest('base64')}`, dependencies: { bar: '1.0.0' } },
        'node_modules/bar': { version: '1.0.0' },
        'node_modules/odd': { version: '1.0.0' },
        'node_modules/@scope/dev-tool': { version: '2.0.0', dev: true },
      },
    })
  );
  // Licence shapes that previously produced invalid output: an SPDX id, an expression, a bare
  // non-SPDX string (`BSD`), and no licence at all.
  const licenses: Array<[string, string | undefined]> = [['foo', '(MIT OR Apache-2.0)'], ['bar', 'BSD'], ['odd', undefined], ['@scope/dev-tool', 'MIT']];
  for (const [name, license] of licenses) {
    mkdirSync(join(dir, 'node_modules', name), { recursive: true });
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: name === '@scope/dev-tool' ? '2.0.0' : '1.0.0', ...(license ? { license } : {}) }));
  }
}

test('sbom - the document validates against the official CycloneDX 1.6 schema', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sbom-schema-'));
  try {
    writeProject(dir);
    const doc = JSON.parse(await captureStdout(() => sbomCommand({ cwd: dir })));
    assert.deepEqual(validator()(doc), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sbom --vex - the document with a vulnerabilities section validates against the schema', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sbom-schema-'));
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = url.toString();
    if (u.includes('querybatch')) return { ok: true, json: async () => ({ results: [{ vulns: [{ id: 'GHSA-xxxx-yyyy-zzzz' }] }, { vulns: [] }, { vulns: [] }, { vulns: [] }] }) } as Response;
    if (u.includes('/vulns/GHSA-xxxx-yyyy-zzzz')) {
      return { ok: true, json: async () => ({ id: 'GHSA-xxxx-yyyy-zzzz', summary: 'Bad bug', database_specific: { severity: 'MODERATE' }, references: [{ url: 'https://example.test/adv' }] }) } as Response;
    }
    return { ok: false } as Response;
  }) as typeof fetch;
  try {
    writeProject(dir);
    const doc = JSON.parse(await captureStdout(() => sbomCommand({ cwd: dir, vex: true })));
    assert.ok(Array.isArray(doc.vulnerabilities) && doc.vulnerabilities.length > 0, 'fixture should produce at least one vulnerability');
    assert.deepEqual(validator()(doc), []);
  } finally {
    globalThis.fetch = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sbom schema validator - rejects a document it should reject (guards against a vacuous pass)', () => {
  const errors = validator()({ bomFormat: 'CycloneDX', specVersion: '1.6', components: [{ type: 'library', name: 'x', licenses: [{ license: { id: 'BSD' } }] }] });
  assert.ok(errors.length > 0);
});
