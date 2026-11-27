#!/usr/bin/env node
// CI glue for the rn-dep-scanner GitHub Action: downloads the base `size measure` snapshot that an
// earlier run on the base branch uploaded as a workflow artifact, so `size diff` has something to
// compare against. Action-only tooling (GitHub's artifact API), deliberately not part of src/ —
// the CLI itself stays CI-agnostic and only ever sees two snapshot files.
//
// Never throws into the workflow: every outcome is `found`, `not-found` or `unavailable`, written
// to the status file and $GITHUB_OUTPUT, and the process always exits 0. A missing baseline is a
// reportable state, not a pass or a failure (ADR-0004).
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SNAPSHOT_SCHEMA_VERSION = 1;
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

async function loadZip() {
  try {
    return await import('rn-dep-scanner/dist/utils/zip.js');
  } catch {
    // Same dogfooding fallback as post-pr-comment.mjs.
    return await import('../dist/utils/zip.js');
  }
}

/**
 * Picks the newest usable baseline artifact. Only an artifact produced by a run of *this*
 * repository on the base branch counts: a fork can push a branch with the same name and upload an
 * artifact with the same name, and trusting it would let a fork PR choose its own baseline.
 */
export function selectBaselineArtifact(artifacts, { repositoryId, branch }) {
  const candidates = artifacts
    .filter((a) => a && !a.expired)
    .filter((a) => a.workflow_run?.head_branch === branch)
    .filter((a) => repositoryId !== undefined && a.workflow_run?.head_repository_id === repositoryId)
    .filter((a) => a.size_in_bytes === undefined || a.size_in_bytes <= MAX_ARTIFACT_BYTES)
    .sort((a, b) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? ''));
  return candidates[0] ?? null;
}

/** The download URL comes from an API response; only follow it if it points at this repo's artifacts. */
export function isTrustedDownloadUrl(url, repo) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'api.github.com' &&
      parsed.pathname.startsWith(`/repos/${repo}/actions/artifacts/`) &&
      parsed.pathname.endsWith('/zip')
    );
  } catch {
    return false;
  }
}

/** Returns the parsed snapshot from a downloaded artifact zip, or `{ error }` — never a guess. */
export async function extractSnapshot(zipBuffer) {
  const { listZipEntries, readZipEntry } = await loadZip();
  const entries = listZipEntries(zipBuffer);
  if (!entries) return { error: 'the artifact is not a readable zip file' };

  const jsonEntries = entries.filter((e) => e.name.toLowerCase().endsWith('.json') && !e.name.endsWith('/'));
  if (jsonEntries.length !== 1) {
    return { error: `expected exactly one .json snapshot in the artifact, found ${jsonEntries.length}` };
  }

  const bytes = readZipEntry(zipBuffer, jsonEntries[0]);
  if (!bytes) return { error: 'could not read the snapshot out of the artifact zip' };

  let snapshot;
  try {
    snapshot = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { error: 'the snapshot in the artifact is not valid JSON' };
  }

  if (typeof snapshot !== 'object' || snapshot === null || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    return { error: `the snapshot's schemaVersion is not ${SNAPSHOT_SCHEMA_VERSION}` };
  }
  if (!Array.isArray(snapshot.modules) || typeof snapshot.totals?.jsBytes !== 'number') {
    return { error: 'the snapshot is missing its modules or totals' };
  }
  return { snapshot };
}

/**
 * Finds, downloads and validates the baseline snapshot.
 * `fetchImpl` is injectable so the GitHub API can be mocked in tests.
 */
export async function fetchBaseline({ repo, token, artifactName, branch, fetchImpl = fetch }) {
  const apiBase = `https://api.github.com/repos/${repo}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'rn-dep-scanner-action',
  };

  let artifacts;
  let repositoryId;
  try {
    const repoRes = await fetchImpl(apiBase, { headers });
    if (!repoRes.ok) return { status: 'unavailable', reason: `could not read the repository (HTTP ${repoRes.status})` };
    repositoryId = (await repoRes.json()).id;

    const listRes = await fetchImpl(`${apiBase}/actions/artifacts?name=${encodeURIComponent(artifactName)}&per_page=100`, { headers });
    if (!listRes.ok) return { status: 'unavailable', reason: `could not list artifacts (HTTP ${listRes.status})` };
    artifacts = (await listRes.json()).artifacts ?? [];
  } catch (error) {
    return { status: 'unavailable', reason: `GitHub API request failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  const artifact = selectBaselineArtifact(artifacts, { repositoryId, branch });
  if (!artifact) {
    return {
      status: 'not-found',
      reason: `no unexpired "${artifactName}" artifact from a ${branch} run of this repository`,
    };
  }
  if (!isTrustedDownloadUrl(artifact.archive_download_url, repo)) {
    return { status: 'unavailable', reason: 'the artifact download URL did not point at this repository' };
  }

  let zipBuffer;
  try {
    const dlRes = await fetchImpl(artifact.archive_download_url, { headers });
    if (!dlRes.ok) return { status: 'unavailable', reason: `could not download the artifact (HTTP ${dlRes.status})` };
    zipBuffer = Buffer.from(await dlRes.arrayBuffer());
  } catch (error) {
    return { status: 'unavailable', reason: `artifact download failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (zipBuffer.length > MAX_ARTIFACT_BYTES) return { status: 'unavailable', reason: 'the artifact is larger than 50 MB' };

  const extracted = await extractSnapshot(zipBuffer);
  if ('error' in extracted) return { status: 'unavailable', reason: extracted.error };

  return { status: 'found', snapshot: extracted.snapshot, artifactId: artifact.id, createdAt: artifact.created_at };
}

function resolveBranch() {
  if (process.env.SIZE_BASELINE_BRANCH) return process.env.SIZE_BASELINE_BRANCH;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'));
    return event?.pull_request?.base?.ref ?? event?.repository?.default_branch ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const [snapshotOut = 'rn-dep-scanner-size-base.json', statusOut = 'rn-dep-scanner-size-baseline.json'] = process.argv.slice(2);
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, SIZE_BASELINE_ARTIFACT: artifactName } = process.env;

  let result;
  const branch = resolveBranch();
  if (!token || !repo || !artifactName) {
    result = { status: 'unavailable', reason: 'GITHUB_TOKEN, GITHUB_REPOSITORY and the baseline artifact name must be set' };
  } else if (!branch) {
    result = { status: 'unavailable', reason: 'could not determine the base branch; set size-baseline-branch' };
  } else {
    result = await fetchBaseline({ repo, token, artifactName, branch });
  }

  if (result.status === 'found') writeFileSync(snapshotOut, JSON.stringify(result.snapshot));
  const summary = { ...result };
  delete summary.snapshot;
  writeFileSync(statusOut, JSON.stringify({ ...summary, artifactName, branch }, null, 2));

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `status=${result.status}\n`);
  }
  console.log(`Size baseline: ${result.status}${result.reason ? ` — ${result.reason}` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // Even an unexpected bug must not fail the job: report it as unavailable.
    console.error(err);
    const statusOut = process.argv[3] ?? 'rn-dep-scanner-size-baseline.json';
    writeFileSync(statusOut, JSON.stringify({ status: 'unavailable', reason: 'the baseline fetch script failed unexpectedly' }, null, 2));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'status=unavailable\n');
    process.exit(0);
  });
}
