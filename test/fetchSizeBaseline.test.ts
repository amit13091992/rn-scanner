import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { deflateRawSync } from 'node:zlib';
// @ts-expect-error — plain .mjs action script, no type declarations
import { selectBaselineArtifact, isTrustedDownloadUrl, extractSnapshot, fetchBaseline } from '../scripts/fetch-size-baseline.mjs';
import { formatSizeBaselineMissingComment, SIZE_COMMENT_MARKER } from '../src/utils/prComment.js';

const REPO = 'acme/app';
const snapshot = {
  schemaVersion: 1,
  platform: 'ios',
  commitSha: 'abc',
  toolchain: { metroVersion: '0.83.0', hermesVersion: null },
  totals: { jsBytes: 1000, hbcBytes: null, unmappedBytes: 0 },
  modules: [{ id: 'App.tsx', bytes: 1000 }],
};

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds a real zip with DEFLATE entries, the way GitHub packs an uploaded artifact. */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const compressed = deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const artifact = (over: Record<string, unknown> = {}) => ({
  id: 1,
  expired: false,
  created_at: '2026-11-01T00:00:00Z',
  size_in_bytes: 100,
  archive_download_url: `https://api.github.com/repos/${REPO}/actions/artifacts/1/zip`,
  workflow_run: { head_branch: 'main', head_repository_id: 42 },
  ...over,
});

test('selectBaselineArtifact - picks the newest unexpired artifact from this repo on the branch', () => {
  const picked = selectBaselineArtifact(
    [artifact({ id: 1 }), artifact({ id: 2, created_at: '2026-11-20T00:00:00Z' }), artifact({ id: 3, created_at: '2026-11-25T00:00:00Z', expired: true })],
    { repositoryId: 42, branch: 'main' },
  );
  assert.equal(picked.id, 2);
});

test('selectBaselineArtifact - rejects a fork run and a different branch', () => {
  const picked = selectBaselineArtifact(
    [artifact({ id: 1, workflow_run: { head_branch: 'main', head_repository_id: 99 } }), artifact({ id: 2, workflow_run: { head_branch: 'feat', head_repository_id: 42 } })],
    { repositoryId: 42, branch: 'main' },
  );
  assert.equal(picked, null);
});

test('isTrustedDownloadUrl - only this repo\'s api.github.com artifact zip', () => {
  assert.equal(isTrustedDownloadUrl(`https://api.github.com/repos/${REPO}/actions/artifacts/9/zip`, REPO), true);
  assert.equal(isTrustedDownloadUrl(`https://evil.example/repos/${REPO}/actions/artifacts/9/zip`, REPO), false);
  assert.equal(isTrustedDownloadUrl('https://api.github.com/repos/other/app/actions/artifacts/9/zip', REPO), false);
  assert.equal(isTrustedDownloadUrl(`http://api.github.com/repos/${REPO}/actions/artifacts/9/zip`, REPO), false);
  assert.equal(isTrustedDownloadUrl('not a url', REPO), false);
});

test('extractSnapshot - reads a deflated snapshot from a real zip', async () => {
  const result = await extractSnapshot(makeZip({ 'base.json': JSON.stringify(snapshot) }));
  assert.deepEqual(result.snapshot, snapshot);
});

test('extractSnapshot - reports errors for a non-zip, wrong schema, and ambiguous archives', async () => {
  assert.ok((await extractSnapshot(Buffer.from('nope'))).error);
  assert.match((await extractSnapshot(makeZip({ 'a.json': JSON.stringify({ ...snapshot, schemaVersion: 2 }) }))).error, /schemaVersion/);
  assert.match((await extractSnapshot(makeZip({ 'a.json': '{}', 'b.json': '{}' }))).error, /exactly one/);
  assert.match((await extractSnapshot(makeZip({ 'a.json': 'not json' }))).error, /not valid JSON/);
});

function mockFetch(routes: { artifacts?: unknown[]; zip?: Buffer; repoStatus?: number; listStatus?: number }) {
  return async (url: string) => {
    if (url === `https://api.github.com/repos/${REPO}`) {
      return { ok: (routes.repoStatus ?? 200) === 200, status: routes.repoStatus ?? 200, json: async () => ({ id: 42 }) };
    }
    if (url.includes('/actions/artifacts?')) {
      return { ok: (routes.listStatus ?? 200) === 200, status: routes.listStatus ?? 200, json: async () => ({ artifacts: routes.artifacts ?? [] }) };
    }
    const zip = routes.zip ?? Buffer.alloc(0);
    return { ok: true, status: 200, arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) };
  };
}

const args = { repo: REPO, token: 't', artifactName: 'size-base', branch: 'main' };

test('fetchBaseline - found: downloads and validates the snapshot', async () => {
  const result = await fetchBaseline({ ...args, fetchImpl: mockFetch({ artifacts: [artifact()], zip: makeZip({ 'base.json': JSON.stringify(snapshot) }) }) });
  assert.equal(result.status, 'found');
  assert.deepEqual(result.snapshot, snapshot);
});

test('fetchBaseline - not-found when no artifact qualifies', async () => {
  const result = await fetchBaseline({ ...args, fetchImpl: mockFetch({ artifacts: [] }) });
  assert.equal(result.status, 'not-found');
});

test('fetchBaseline - unavailable (not not-found) when the GitHub API fails', async () => {
  const result = await fetchBaseline({ ...args, fetchImpl: mockFetch({ listStatus: 403 }) });
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /403/);
});

test('fetchBaseline - unavailable when the artifact URL is not trusted', async () => {
  const result = await fetchBaseline({ ...args, fetchImpl: mockFetch({ artifacts: [artifact({ archive_download_url: 'https://evil.example/x/zip' })] }) });
  assert.equal(result.status, 'unavailable');
});

test('formatSizeBaselineMissingComment - shares the size marker and says not checked', () => {
  const body = formatSizeBaselineMissingComment({ status: 'not-found', reason: 'none' });
  assert.ok(body.startsWith(SIZE_COMMENT_MARKER));
  assert.match(body, /Not checked/);
});
