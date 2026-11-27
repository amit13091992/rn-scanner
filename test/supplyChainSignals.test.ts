import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInstallScriptHooks } from '../src/detectors/installScripts.js';
import { analyzeSupplyChainSignals } from '../src/analyzers/supplyChainSignals.js';
import { buildDependencyGraph } from '../src/utils/dependencyGraph.js';

function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'supply-chain-'));
  const install = (name: string, scripts?: Record<string, string>): void => {
    mkdirSync(join(dir, 'node_modules', name), { recursive: true });
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...(scripts ? { scripts } : {}) }));
  };
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { direct: '1.0.0', fresh: '1.0.0' } }));
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'app', dependencies: { direct: '1.0.0', fresh: '1.0.0' } },
        'node_modules/direct': { version: '1.0.0', dependencies: { deep: '1.0.0' } },
        'node_modules/fresh': { version: '1.0.0' },
        'node_modules/deep': { version: '1.0.0' },
      },
    })
  );
  install('direct', { test: 'jest' });
  install('fresh');
  install('deep', { postinstall: 'node setup.js', build: 'tsc' });
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('readInstallScriptHooks - lists only install-time hooks; null when not installed', () =>
  withProject(async (dir) => {
    assert.deepEqual(readInstallScriptHooks(dir, 'deep'), ['postinstall']);
    assert.deepEqual(readInstallScriptHooks(dir, 'direct'), []);
    assert.equal(readInstallScriptHooks(dir, 'missing'), null);
  }));

test('analyzeSupplyChainSignals - flags a transitive install script and a version published days ago', () =>
  withProject(async (dir) => {
    const graph = await buildDependencyGraph(dir);
    const now = new Date('2026-11-27T00:00:00Z');
    const published: Record<string, string> = {
      'deep@1.0.0': '2026-11-20T00:00:00Z',
      'fresh@1.0.0': '2026-11-26T00:00:00Z',
      'direct@1.0.0': '2025-01-01T00:00:00Z',
    };
    const signals = await analyzeSupplyChainSignals(dir, graph, {
      now,
      fetchPublishTime: async (name, version) => {
        const v = published[`${name}@${version}`];
        return v ? new Date(v) : undefined;
      },
    });

    assert.equal(signals.scanned, true);
    assert.deepEqual(signals.installScripts.map((s) => [s.package, s.hooks, s.direct]), [['deep', ['postinstall'], false]]);
    assert.deepEqual(signals.recentlyPublished.map((r) => [r.package, r.ageDays]), [['fresh', 1]]);
    assert.equal(signals.releaseAge.checked, 3);
  }));

test('analyzeSupplyChainSignals - a failed publish-time lookup is not-checked, never assumed old or new', () =>
  withProject(async (dir) => {
    const graph = await buildDependencyGraph(dir);
    const signals = await analyzeSupplyChainSignals(dir, graph, { fetchPublishTime: async () => undefined });
    assert.equal(signals.recentlyPublished.length, 0);
    assert.equal(signals.releaseAge.checked, 0);
    assert.equal(signals.releaseAge.notChecked.lookup_failed, 3);
  }));

test('analyzeSupplyChainSignals - lookup cap leaves the remainder not-checked; no graph is not a clean scan', () =>
  withProject(async (dir) => {
    const graph = await buildDependencyGraph(dir);
    const signals = await analyzeSupplyChainSignals(dir, graph, {
      maxPublishLookups: 1,
      fetchPublishTime: async () => new Date('2020-01-01T00:00:00Z'),
    });
    assert.equal(signals.releaseAge.checked, 1);
    assert.equal(signals.releaseAge.notChecked.lookup_cap, 2);

    assert.equal((await analyzeSupplyChainSignals(dir, null)).scanned, false);
  }));

test('analyzeSupplyChainSignals - minReleaseAgeDays 0 turns release-age lookups off without reporting them as failed', () =>
  withProject(async (dir) => {
    const graph = await buildDependencyGraph(dir);
    let lookups = 0;
    const signals = await analyzeSupplyChainSignals(dir, graph, {
      minReleaseAgeDays: 0,
      fetchPublishTime: async () => {
        lookups++;
        return new Date();
      },
    });
    assert.equal(lookups, 0);
    assert.equal(signals.releaseAge.minAgeDays, 0);
    assert.deepEqual(signals.releaseAge.notChecked, {});
    assert.equal(signals.installScripts.length, 1, 'install-script detection is unaffected');
  }));

test('analyzeSupplyChainSignals - a larger threshold flags versions a smaller one lets through', () =>
  withProject(async (dir) => {
    const graph = await buildDependencyGraph(dir);
    const fetchPublishTime = async () => new Date('2026-11-01T00:00:00Z');
    const now = new Date('2026-11-27T00:00:00Z');
    assert.equal((await analyzeSupplyChainSignals(dir, graph, { now, fetchPublishTime, minReleaseAgeDays: 7 })).recentlyPublished.length, 0);
    assert.equal((await analyzeSupplyChainSignals(dir, graph, { now, fetchPublishTime, minReleaseAgeDays: 30 })).recentlyPublished.length, 3);
  }));
