import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseOsvSeverity, extractFixedVersion, parseOsvRecord, queryVulnerabilities } from '../src/services/osvClient.js';
import { analyzeSecurityVulnerabilities } from '../src/analyzers/securityVulnerabilities.js';
import type { DependencyGraph } from '../src/types/dependencyGraph.js';

test('parseOsvSeverity - reads database_specific.severity when present', () => {
  assert.equal(parseOsvSeverity({ id: 'X', database_specific: { severity: 'HIGH' } }), 'high');
});

test('parseOsvSeverity - unknown when no database_specific.severity is present', () => {
  assert.equal(parseOsvSeverity({ id: 'X' }), 'unknown');
});

test('extractFixedVersion - finds fixed event for the matching package', () => {
  const record = {
    id: 'X',
    affected: [
      {
        package: { name: 'lodash', ecosystem: 'npm' },
        ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }],
      },
    ],
  };
  assert.equal(extractFixedVersion(record, 'lodash'), '4.17.21');
});

test('extractFixedVersion - picks the fix for the range that actually contains the installed version', () => {
  // Two ranges: 1.x line fixed at 1.5.0, 2.x line fixed at 2.3.0. Installed is 2.0.0, so the
  // correct answer is 2.3.0, not the first-encountered 1.5.0.
  const record = {
    id: 'X',
    affected: [
      {
        package: { name: 'pkg' },
        ranges: [
          { events: [{ introduced: '1.0.0' }, { fixed: '1.5.0' }] },
          { events: [{ introduced: '2.0.0' }, { fixed: '2.3.0' }] },
        ],
      },
    ],
  };
  assert.equal(extractFixedVersion(record, 'pkg', '2.0.0'), '2.3.0');
});

test('extractFixedVersion - falls back to nearest fix ahead of installed when no interval matches', () => {
  const record = {
    id: 'X',
    affected: [
      { package: { name: 'pkg' }, ranges: [{ events: [{ fixed: '1.5.0' }] }, { events: [{ fixed: '3.0.0' }] }] },
    ],
  };
  // Installed (5.0.0) is past every known fixed version — no interval contains it — but the
  // nearest one ahead should still be picked over an arbitrary first match.
  assert.equal(extractFixedVersion(record, 'pkg', '5.0.0'), undefined);
  assert.equal(extractFixedVersion(record, 'pkg', '2.0.0'), '3.0.0');
});

test('extractFixedVersion - undefined when package does not match', () => {
  const record = {
    id: 'X',
    affected: [{ package: { name: 'other-pkg' }, ranges: [{ events: [{ fixed: '1.0.0' }] }] }],
  };
  assert.equal(extractFixedVersion(record, 'lodash'), undefined);
});

test('parseOsvRecord - assembles a full VulnerabilityInfo', () => {
  const record = {
    id: 'GHSA-test-1234',
    summary: 'Prototype pollution',
    database_specific: { severity: 'HIGH' },
    affected: [{ package: { name: 'lodash' }, ranges: [{ events: [{ fixed: '4.17.21' }] }] }],
    references: [{ url: 'https://example.com/advisory' }],
  };
  const info = parseOsvRecord(record, 'lodash');
  assert.equal(info.id, 'GHSA-test-1234');
  assert.equal(info.summary, 'Prototype pollution');
  assert.equal(info.severity, 'high');
  assert.equal(info.fixedVersion, '4.17.21');
  assert.deepEqual(info.references, ['https://example.com/advisory']);
});

test('queryVulnerabilities - empty package list scans successfully with no results', async () => {
  const result = await queryVulnerabilities([]);
  assert.equal(result.scanned, true);
  assert.deepEqual(result.results, []);
});

test('queryVulnerabilities - network failure degrades gracefully instead of throwing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network unreachable');
  }) as typeof fetch;

  try {
    const result = await queryVulnerabilities([{ name: 'lodash', version: '4.17.15' }]);
    assert.equal(result.scanned, false);
    assert.ok(result.error);
    assert.deepEqual(result.results, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('queryVulnerabilities - assembles results from mocked batch + detail responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes('querybatch')) {
      return {
        ok: true,
        json: async () => ({ results: [{ vulns: [{ id: 'GHSA-abc-123' }] }] }),
      } as Response;
    }
    if (urlStr.includes('/vulns/GHSA-abc-123')) {
      return {
        ok: true,
        json: async () => ({
          id: 'GHSA-abc-123',
          summary: 'Test vuln',
          database_specific: { severity: 'CRITICAL' },
          affected: [{ package: { name: 'lodash' }, ranges: [{ events: [{ fixed: '4.17.21' }] }] }],
          references: [],
        }),
      } as Response;
    }
    void init;
    return { ok: false } as Response;
  }) as typeof fetch;

  try {
    const result = await queryVulnerabilities([{ name: 'lodash', version: '4.17.15' }]);
    assert.equal(result.scanned, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.package, 'lodash');
    assert.equal(result.results[0]?.vulnerabilities[0]?.severity, 'critical');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('queryVulnerabilities - correctly maps vulnerability IDs to the right package across a multi-package batch', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes('querybatch')) {
      const body = JSON.parse((init?.body as string) ?? '{}');
      // Confirm the request itself is positional/ordered as expected.
      assert.equal(body.queries[0].package.name, 'clean-pkg');
      assert.equal(body.queries[1].package.name, 'vuln-pkg');
      // First package (clean-pkg) has zero vulns, second (vuln-pkg) has one — this is exactly
      // the shape where an off-by-one in index mapping would misattribute the vuln.
      return { ok: true, json: async () => ({ results: [{ vulns: [] }, { vulns: [{ id: 'GHSA-only-vuln-pkg' }] }] }) } as Response;
    }
    if (urlStr.includes('/vulns/GHSA-only-vuln-pkg')) {
      return {
        ok: true,
        json: async () => ({
          id: 'GHSA-only-vuln-pkg',
          summary: 'Only affects vuln-pkg',
          database_specific: { severity: 'LOW' },
          references: [],
        }),
      } as Response;
    }
    return { ok: false } as Response;
  }) as typeof fetch;

  try {
    const result = await queryVulnerabilities([
      { name: 'clean-pkg', version: '1.0.0' },
      { name: 'vuln-pkg', version: '2.0.0' },
    ]);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.package, 'vuln-pkg');
    assert.equal(result.results[0]?.vulnerabilities[0]?.id, 'GHSA-only-vuln-pkg');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('queryVulnerabilities - a shared vulnerability ID across two packages is fetched once and applied to both', async () => {
  const originalFetch = globalThis.fetch;
  let detailFetchCount = 0;
  globalThis.fetch = (async (url: string | URL) => {
    const urlStr = url.toString();
    if (urlStr.includes('querybatch')) {
      return {
        ok: true,
        json: async () => ({ results: [{ vulns: [{ id: 'GHSA-shared' }] }, { vulns: [{ id: 'GHSA-shared' }] }] }),
      } as Response;
    }
    if (urlStr.includes('/vulns/GHSA-shared')) {
      detailFetchCount++;
      return { ok: true, json: async () => ({ id: 'GHSA-shared', summary: 'Shared advisory', references: [] }) } as Response;
    }
    return { ok: false } as Response;
  }) as typeof fetch;

  try {
    const result = await queryVulnerabilities([
      { name: 'pkg-a', version: '1.0.0' },
      { name: 'pkg-b', version: '1.0.0' },
    ]);
    assert.equal(detailFetchCount, 1);
    assert.equal(result.results.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('queryVulnerabilities - a failed detail fetch drops just that vulnerability, not the whole scan', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const urlStr = url.toString();
    if (urlStr.includes('querybatch')) {
      return { ok: true, json: async () => ({ results: [{ vulns: [{ id: 'GHSA-unreachable' }] }] }) } as Response;
    }
    if (urlStr.includes('/vulns/GHSA-unreachable')) {
      return { ok: false } as Response;
    }
    return { ok: false } as Response;
  }) as typeof fetch;

  try {
    const result = await queryVulnerabilities([{ name: 'pkg', version: '1.0.0' }]);
    assert.equal(result.scanned, true);
    assert.deepEqual(result.results, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('analyzeSecurityVulnerabilities - skips a dependency whose only version signal is a non-exact range', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: string | undefined;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (url.toString().includes('querybatch')) {
      capturedBody = init?.body as string;
      return { ok: true, json: async () => ({ results: [] }) } as Response;
    }
    return { ok: false } as Response;
  }) as typeof fetch;

  try {
    await analyzeSecurityVulnerabilities([
      // No resolvedVersion, and requestedVersion is a range/wildcard/workspace ref — none of
      // these represent one real installed version, so none should be sent to OSV.
      { name: 'range-only', requestedVersion: '^1.2.3', type: 'dependency' },
      { name: 'wildcard-only', requestedVersion: '*', type: 'dependency' },
      { name: 'workspace-only', requestedVersion: 'workspace:*', type: 'dependency' },
      // This one is an exact pin with no resolvedVersion — should still be queried.
      { name: 'exact-pin', requestedVersion: '1.2.3', type: 'dependency' },
    ]);
    const parsed = JSON.parse(capturedBody ?? '{"queries":[]}');
    assert.deepEqual(parsed.queries.map((q: { package: { name: string } }) => q.package.name), ['exact-pin']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('analyzeSecurityVulnerabilities - summarizes severities and uses resolvedVersion over requestedVersion', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: string | undefined;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes('querybatch')) {
      capturedBody = init?.body as string;
      return { ok: true, json: async () => ({ results: [{ vulns: [] }] }) } as Response;
    }
    return { ok: false } as Response;
  }) as typeof fetch;

  try {
    const result = await analyzeSecurityVulnerabilities([
      { name: 'lodash', requestedVersion: '^4.17.0', resolvedVersion: '4.17.15', type: 'dependency' },
    ]);
    assert.equal(result.scanned, true);
    assert.deepEqual(result.summary, { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 });
    assert.ok(capturedBody?.includes('4.17.15'));
    assert.ok(!capturedBody?.includes('^4.17.0'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/**
 * Builds a fake npm-shaped dependency graph for:
 *   your-app -> eslint@8.0.0 -> file-entry-cache@6.0.0 -> flat-cache@3.0.0 -> keyv@4.0.0
 * mirroring the real-world case (a vulnerable transitive package several levels deep) this
 * graph-based security scan is meant to catch.
 */
function makeDeepChainGraph(): DependencyGraph {
  const nodes = new Map<string, DependencyGraph['nodes'] extends Map<string, infer V> ? V : never>([
    ['', { name: '', version: '', parents: [], children: ['node_modules/eslint'] }],
    ['node_modules/eslint', { name: 'eslint', version: '8.0.0', parents: [''], children: ['node_modules/eslint/node_modules/file-entry-cache'] }],
    ['node_modules/eslint/node_modules/file-entry-cache', { name: 'file-entry-cache', version: '6.0.0', parents: ['node_modules/eslint'], children: ['node_modules/eslint/node_modules/file-entry-cache/node_modules/flat-cache'] }],
    ['node_modules/eslint/node_modules/file-entry-cache/node_modules/flat-cache', { name: 'flat-cache', version: '3.0.0', parents: ['node_modules/eslint/node_modules/file-entry-cache'], children: ['node_modules/eslint/node_modules/file-entry-cache/node_modules/flat-cache/node_modules/keyv'] }],
    ['node_modules/eslint/node_modules/file-entry-cache/node_modules/flat-cache/node_modules/keyv', { name: 'keyv', version: '4.0.0', parents: ['node_modules/eslint/node_modules/file-entry-cache/node_modules/flat-cache'], children: [] }],
  ]);
  return { manager: 'npm', hierarchyComplete: true, root: '', nodes };
}

test('analyzeSecurityVulnerabilities - finds a vulnerable transitive package several levels deep and reports its path', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: string | undefined;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes('querybatch')) {
      capturedBody = init?.body as string;
      const parsed = JSON.parse(capturedBody!);
      const results = parsed.queries.map((q: { package: { name: string } }) =>
        q.package.name === 'keyv' ? { vulns: [{ id: 'GHSA-keyv-deep' }] } : { vulns: [] }
      );
      return { ok: true, json: async () => ({ results }) } as Response;
    }
    if (urlStr.includes('/vulns/GHSA-keyv-deep')) {
      return {
        ok: true,
        json: async () => ({
          id: 'GHSA-keyv-deep',
          summary: 'Deep transitive vulnerability',
          database_specific: { severity: 'HIGH' },
          references: [],
        }),
      } as Response;
    }
    return { ok: false } as Response;
  }) as typeof fetch;

  try {
    const graph = makeDeepChainGraph();
    // `dependencies` (package.json-only) deliberately does not include keyv at all — proving
    // the graph, not the direct-dependency list, is what finds it.
    const result = await analyzeSecurityVulnerabilities(
      [{ name: 'eslint', resolvedVersion: '8.0.0', requestedVersion: '8.0.0', type: 'devDependency' }],
      [],
      graph
    );

    assert.equal(result.scanned, true);
    assert.equal(result.results.length, 1);
    const [keyvResult] = result.results;
    assert.equal(keyvResult.package, 'keyv');
    assert.equal(keyvResult.version, '4.0.0');
    assert.equal(keyvResult.direct, false);
    assert.deepEqual(keyvResult.paths, [['eslint', 'file-entry-cache', 'flat-cache', 'keyv']]);
    assert.equal(result.summary.high, 1);

    // Every queried package should include keyv even though it's absent from `dependencies`.
    const queriedNames = JSON.parse(capturedBody ?? '{"queries":[]}').queries.map((q: { package: { name: string } }) => q.package.name);
    assert.ok(queriedNames.includes('keyv'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('analyzeSecurityVulnerabilities - a direct dependency found via the graph is reported as direct with a single-element path', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const urlStr = url.toString();
    if (urlStr.includes('querybatch')) {
      return { ok: true, json: async () => ({ results: [{ vulns: [{ id: 'GHSA-eslint-direct' }] }, {}, {}, {}] }) } as Response;
    }
    if (urlStr.includes('/vulns/GHSA-eslint-direct')) {
      return {
        ok: true,
        json: async () => ({ id: 'GHSA-eslint-direct', summary: 'Direct dep issue', database_specific: { severity: 'MODERATE' }, references: [] }),
      } as Response;
    }
    return { ok: false } as Response;
  }) as typeof fetch;

  try {
    const graph = makeDeepChainGraph();
    const result = await analyzeSecurityVulnerabilities([], [], graph);

    assert.equal(result.scanned, true);
    assert.equal(result.results.length, 1);
    const [eslintResult] = result.results;
    assert.equal(eslintResult.package, 'eslint');
    assert.equal(eslintResult.direct, true);
    assert.deepEqual(eslintResult.paths, [['eslint']]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('analyzeSecurityVulnerabilities - ignoreVulnerabilityIds suppresses a specific advisory and drops the package once empty', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const urlStr = url.toString();
    if (urlStr.includes('querybatch')) {
      return { ok: true, json: async () => ({ results: [{ vulns: [{ id: 'GHSA-ignored' }] }] }) } as Response;
    }
    if (urlStr.includes('/vulns/GHSA-ignored')) {
      return {
        ok: true,
        json: async () => ({ id: 'GHSA-ignored', summary: 'Accepted risk', database_specific: { severity: 'LOW' }, references: [] }),
      } as Response;
    }
    return { ok: false } as Response;
  }) as typeof fetch;

  try {
    const result = await analyzeSecurityVulnerabilities(
      [{ name: 'pkg', resolvedVersion: '1.0.0', requestedVersion: '1.0.0', type: 'dependency' }],
      ['GHSA-ignored']
    );
    assert.equal(result.results.length, 0);
    assert.deepEqual(result.summary, { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
