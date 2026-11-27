import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sbomCommand } from '../src/commands/sbom.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'sbom-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function captureStdout(fn: () => Promise<void>): Promise<{ output: string }> {
  const originalLog = console.log;
  let output = '';
  console.log = (msg?: unknown) => {
    output += `${String(msg)}\n`;
  };
  return fn().then(() => ({ output })).finally(() => {
    console.log = originalLog;
  });
}

test('sbomCommand - emits a valid CycloneDX document with one component per installed package', async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', version: '1.2.3', dependencies: { foo: '1.0.0' } }));
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'app', dependencies: { foo: '1.0.0' } },
          'node_modules/foo': { version: '1.0.0' },
        },
      })
    );
    mkdirSync(join(dir, 'node_modules', 'foo'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'foo', 'package.json'), JSON.stringify({ name: 'foo', version: '1.0.0', license: 'MIT' }));

    const { output } = await captureStdout(() => sbomCommand({ cwd: dir }));
    const sbom = JSON.parse(output);

    assert.equal(sbom.bomFormat, 'CycloneDX');
    assert.equal(sbom.metadata.component.name, 'app');
    assert.equal(sbom.components.length, 1);
    assert.equal(sbom.components[0].name, 'foo');
    assert.equal(sbom.components[0].purl, 'pkg:npm/foo@1.0.0');
    assert.deepEqual(sbom.components[0].licenses, [{ license: { id: 'MIT' } }]);
  } finally {
    cleanup(dir);
  }
});

function writeProject(dir: string): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', version: '1.2.3', dependencies: { foo: '1.0.0' }, devDependencies: { '@scope/dev-tool': '2.0.0' } }));
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'app', dependencies: { foo: '1.0.0' }, devDependencies: { '@scope/dev-tool': '2.0.0' } },
        'node_modules/foo': { version: '1.0.0', integrity: `sha512-${Buffer.from('abcd', 'hex').toString('base64')}`, dependencies: { bar: '1.0.0' } },
        'node_modules/bar': { version: '1.0.0' },
        'node_modules/@scope/dev-tool': { version: '2.0.0', dev: true },
      },
    })
  );
  for (const [name, license] of [['foo', '(MIT OR Apache-2.0)'], ['bar', 'UNLICENSED'], ['@scope/dev-tool', 'MIT']] as const) {
    mkdirSync(join(dir, 'node_modules', name), { recursive: true });
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0', license }));
  }
}

test('sbomCommand - emits CycloneDX 1.6 with refs, edges, hashes, dev scope, scoped group and license shapes', async () => {
  const dir = makeTempDir();
  try {
    writeProject(dir);
    const { output } = await captureStdout(() => sbomCommand({ cwd: dir }));
    const sbom = JSON.parse(output);

    assert.equal(sbom.specVersion, '1.6');
    assert.match(sbom.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/);
    assert.equal(sbom.metadata.tools.components[0].name, 'rn-dep-scanner');
    assert.equal(sbom.metadata.component['bom-ref'], 'pkg:npm/app@1.2.3');

    const byName = Object.fromEntries(sbom.components.map((c: any) => [c.name, c]));
    assert.equal(byName.foo.hashes[0].alg, 'SHA-512');
    assert.equal(byName.foo.hashes[0].content, 'abcd');
    assert.equal(byName.bar.hashes, undefined, 'no integrity in the lockfile means no hash, never a made-up one');
    assert.deepEqual(byName.foo.licenses, [{ expression: '(MIT OR Apache-2.0)' }]);
    assert.deepEqual(byName.bar.licenses, [{ license: { name: 'UNLICENSED' } }]);
    assert.equal(byName['dev-tool'].group, '@scope');
    assert.equal(byName['dev-tool'].purl, 'pkg:npm/%40scope/dev-tool@2.0.0');
    assert.equal(byName['dev-tool'].scope, 'optional');
    assert.equal(byName.foo.scope, 'required');

    const edges = Object.fromEntries(sbom.dependencies.map((d: any) => [d.ref, d.dependsOn]));
    assert.deepEqual(edges['pkg:npm/app@1.2.3'], ['pkg:npm/%40scope/dev-tool@2.0.0', 'pkg:npm/foo@1.0.0']);
    assert.deepEqual(edges['pkg:npm/foo@1.0.0'], ['pkg:npm/bar@1.0.0']);
    assert.equal(sbom.vulnerabilities, undefined);

    const refs = new Set([...sbom.components.map((c: any) => c['bom-ref']), sbom.metadata.component['bom-ref']]);
    for (const d of sbom.dependencies) {
      assert.ok(refs.has(d.ref));
      d.dependsOn.forEach((r: string) => assert.ok(refs.has(r), `dangling ref ${r}`));
    }
  } finally {
    cleanup(dir);
  }
});

function mockOsv(vulnIds: string[] | 'down'): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = url.toString();
    if (vulnIds === 'down') return { ok: false } as Response;
    if (u.includes('querybatch')) {
      const body = { results: [{ vulns: vulnIds.map((id) => ({ id })) }, { vulns: [] }, { vulns: [] }] };
      return { ok: true, json: async () => body } as Response;
    }
    const id = vulnIds.find((v) => u.includes(`/vulns/${v}`));
    if (id) {
      return {
        ok: true,
        json: async () => ({ id, summary: 'Bad bug', database_specific: { severity: 'MODERATE' }, references: [{ url: 'https://example.test/adv' }] }),
      } as Response;
    }
    return { ok: false } as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test('sbomCommand --vex - embeds findings as in_triage vulnerabilities pointing at the affected component', async () => {
  const dir = makeTempDir();
  const restore = mockOsv(['GHSA-vex-test']);
  try {
    writeProject(dir);
    const { output } = await captureStdout(() => sbomCommand({ cwd: dir, vex: true }));
    const sbom = JSON.parse(output);
    assert.equal(sbom.vulnerabilities.length, 1);
    const v = sbom.vulnerabilities[0];
    assert.equal(v.id, 'GHSA-vex-test');
    assert.equal(v.ratings[0].severity, 'medium');
    assert.equal(v.analysis.state, 'in_triage');
    assert.deepEqual(v.affects.map((a: any) => a.ref).length, 1);
    assert.ok(sbom.components.some((c: any) => c['bom-ref'] === v.affects[0].ref));
    assert.deepEqual(v.advisories, [{ url: 'https://example.test/adv' }]);
  } finally {
    restore();
    cleanup(dir);
  }
});

test('sbomCommand --vex - refuses to emit a VEX section when the vulnerability scan could not run', async () => {
  const dir = makeTempDir();
  const restore = mockOsv('down');
  const originalExit = process.exit;
  const originalError = console.log;
  let exitCode: number | undefined;
  let output = '';
  // @ts-expect-error - stub for the duration of the test
  process.exit = (code?: number) => {
    exitCode = code;
    throw new Error('__exit__');
  };
  console.log = (m?: unknown) => {
    output += `${String(m)}\n`;
  };
  try {
    writeProject(dir);
    await sbomCommand({ cwd: dir, vex: true }).catch(() => undefined);
    assert.equal(exitCode, 1);
    assert.match(output, /Cannot build the VEX section/);
    assert.equal(output.includes('"bomFormat"'), false, 'no BOM may be printed with an unknown vulnerability state');
  } finally {
    process.exit = originalExit;
    console.log = originalError;
    restore();
    cleanup(dir);
  }
});

test('toCycloneDxLicense - only real SPDX ids become `id`; everything else stays schema-valid', async () => {
  const { toCycloneDxLicense } = await import('../src/analyzers/sbom.js');
  assert.deepEqual(toCycloneDxLicense('MIT'), { license: { id: 'MIT' } });
  assert.deepEqual(toCycloneDxLicense('mit'), { license: { id: 'MIT' } }, 'canonical case');
  assert.deepEqual(toCycloneDxLicense('Apache-2.0'), { license: { id: 'Apache-2.0' } });
  assert.deepEqual(toCycloneDxLicense('(MIT OR Apache-2.0)'), { expression: '(MIT OR Apache-2.0)' });
  // Regression: found by validating against the official CycloneDX 1.6 schema — `BSD` is not an
  // SPDX id, so emitting it as `license.id` made the whole document invalid.
  assert.deepEqual(toCycloneDxLicense('BSD'), { license: { name: 'BSD' } });
  assert.deepEqual(toCycloneDxLicense('UNLICENSED'), { license: { name: 'UNLICENSED' } });
  assert.deepEqual(toCycloneDxLicense('SEE LICENSE IN LICENSE.md'), { license: { name: 'SEE LICENSE IN LICENSE.md' } });
});
