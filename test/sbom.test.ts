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
          '': { name: 'app' },
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
