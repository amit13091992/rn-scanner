import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { analyzePackageSafety, type PackageSafetyDeps } from '../src/analyzers/packageSafety.js';
import type { NpmPackument } from '../src/utils/npmRegistry.js';

const NOW = new Date('2026-11-27T00:00:00Z');

function deps(overrides: Partial<PackageSafetyDeps> & { packument?: NpmPackument } = {}): PackageSafetyDeps {
  const packument: NpmPackument = overrides.packument ?? {
    'dist-tags': { latest: '2.0.0' },
    time: { created: '2020-01-01T00:00:00Z', '2.0.0': '2026-01-01T00:00:00Z' },
    versions: { '2.0.0': {} },
  };
  return {
    lookupPackument: async () => ({ status: 'found', packument }),
    fetchWeeklyDownloads: async () => 50_000,
    queryVulnerabilities: async () => ({ scanned: true, results: [] }),
    now: () => NOW,
    ...overrides,
  };
}

test('analyzePackageSafety - an established clean package is ok', async () => {
  const r = await analyzePackageSafety('good-pkg', undefined, deps());
  assert.equal(r.verdict, 'ok');
  assert.equal(r.version, '2.0.0');
  assert.deepEqual(r.signals, []);
  assert.deepEqual(r.notChecked, []);
});

test('analyzePackageSafety - a name absent from the registry is avoid (likely hallucinated)', async () => {
  const r = await analyzePackageSafety('made-up-pkg', undefined, deps({ lookupPackument: async () => ({ status: 'not_found' }) }));
  assert.equal(r.verdict, 'avoid');
  assert.equal(r.signals[0]?.code, 'not_on_registry');
});

test('analyzePackageSafety - an unreachable registry is unknown, never ok and never "not found"', async () => {
  const r = await analyzePackageSafety('some-pkg', undefined, deps({ lookupPackument: async () => ({ status: 'unavailable' }) }));
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.signals.some((s) => s.code === 'not_on_registry'), false);
  assert.equal(r.notChecked.length, 1);
});

test('analyzePackageSafety - new package, fresh version, low usage and install hooks need review', async () => {
  const r = await analyzePackageSafety(
    'fresh-pkg',
    undefined,
    deps({
      packument: {
        'dist-tags': { latest: '1.0.0' },
        time: { created: '2026-11-20T00:00:00Z', '1.0.0': '2026-11-25T00:00:00Z' },
        versions: { '1.0.0': { scripts: { postinstall: 'node x.js' } } },
      },
      fetchWeeklyDownloads: async () => 12,
    })
  );
  assert.equal(r.verdict, 'review');
  assert.deepEqual(
    r.signals.map((s) => s.code).sort(),
    ['install_scripts', 'low_usage', 'new_package', 'new_version']
  );
  assert.deepEqual(r.details.installHooks, ['postinstall']);
});

test('analyzePackageSafety - a high-severity advisory or a known-malware version is avoid', async () => {
  const vuln = await analyzePackageSafety(
    'good-pkg',
    undefined,
    deps({
      queryVulnerabilities: async () => ({
        scanned: true,
        results: [{ package: 'good-pkg', version: '2.0.0', vulnerabilities: [{ id: 'GHSA-1', summary: 'bad', severity: 'high', references: [] }] }],
      }),
    })
  );
  assert.equal(vuln.verdict, 'avoid');

  const malware = await analyzePackageSafety(
    'keyv',
    '5.0.1',
    deps({ packument: { 'dist-tags': { latest: '5.0.1' }, time: { created: '2019-01-01T00:00:00Z', '5.0.1': '2026-01-01T00:00:00Z' }, versions: { '5.0.1': {} } } })
  );
  assert.equal(malware.verdict, 'avoid');
  assert.ok(malware.signals.some((s) => s.code === 'known_malware'));
});

test('analyzePackageSafety - failed downloads/OSV lookups with no signals are unknown, listed in notChecked', async () => {
  const r = await analyzePackageSafety(
    'good-pkg',
    undefined,
    deps({
      fetchWeeklyDownloads: async () => undefined,
      queryVulnerabilities: async () => ({ scanned: false, error: 'offline', results: [] }),
    })
  );
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.notChecked.length, 2);
});

test('analyzePackageSafety - an unpublished version and an invalid name are avoid', async () => {
  const missing = await analyzePackageSafety('good-pkg', '9.9.9', deps());
  assert.equal(missing.verdict, 'avoid');
  assert.equal(missing.signals.some((s) => s.code === 'version_not_found'), true);

  let called = false;
  const bad = await analyzePackageSafety('../etc/passwd', undefined, deps({ lookupPackument: async () => { called = true; return { status: 'unavailable' }; } }));
  assert.equal(bad.verdict, 'avoid');
  assert.equal(called, false, 'an invalid name must never reach the network');
});
