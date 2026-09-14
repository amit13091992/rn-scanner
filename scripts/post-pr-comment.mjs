#!/usr/bin/env node
// CI glue for the rn-dep-scanner GitHub Action: reads a `doctor`/`upgrade --json` result file
// and posts (or updates) a single PR comment with the READY/WARN/BLOCKED verdict. Kept as a
// plain script rather than part of src/ since it's action-only tooling, not library code.
import { readFileSync } from 'node:fs';

async function loadFormatter() {
  try {
    return await import('rn-dep-scanner/dist/utils/prComment.js');
  } catch {
    // Fallback for dogfooding inside this repo's own checkout, where the "package" being
    // exercised is this repo itself rather than an installed node_modules dependency.
    return await import('../dist/utils/prComment.js');
  }
}

function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  return JSON.parse(readFileSync(eventPath, 'utf8'));
}

async function main() {
  const [resultPath, kind = 'doctor'] = process.argv.slice(2);
  if (!resultPath) {
    console.error('Usage: post-pr-comment.mjs <result.json> [doctor|upgrade]');
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    console.error('GITHUB_TOKEN and GITHUB_REPOSITORY must be set.');
    process.exit(1);
  }

  const event = readEventPayload();
  const prNumber = event?.pull_request?.number ?? event?.number;
  if (!prNumber) {
    console.log('Not running on a pull_request event — skipping PR comment.');
    return;
  }

  const result = JSON.parse(readFileSync(resultPath, 'utf8'));
  const { formatVerdictComment, PR_COMMENT_MARKER } = await loadFormatter();

  const input =
    kind === 'upgrade'
      ? {
          kind: 'upgrade',
          from: result.from,
          to: result.to,
          verdict: result.verdict,
          nodeEnvironment: result.nodeEnvironment ?? [],
          androidEnvironment: result.androidEnvironment ?? [],
          iosEnvironment: result.iosEnvironment ?? [],
        }
      : {
          kind: 'doctor',
          reactNativeVersion: result.reactNative?.version,
          verdict: result.verdict,
          nodeEnvironment: result.nodeEnvironment ?? [],
          androidEnvironment: result.androidEnvironment ?? [],
          iosEnvironment: result.iosEnvironment ?? [],
        };

  const body = formatVerdictComment(input);

  const apiBase = `https://api.github.com/repos/${repo}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'rn-dep-scanner-action',
    'Content-Type': 'application/json',
  };

  const listRes = await fetch(`${apiBase}/issues/${prNumber}/comments?per_page=100`, { headers });
  if (!listRes.ok) {
    throw new Error(`Failed to list PR comments: ${listRes.status} ${await listRes.text()}`);
  }
  const comments = await listRes.json();
  const existing = comments.find((c) => typeof c.body === 'string' && c.body.includes(PR_COMMENT_MARKER));

  if (existing) {
    const patchRes = await fetch(`${apiBase}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body }),
    });
    if (!patchRes.ok) {
      throw new Error(`Failed to update PR comment: ${patchRes.status} ${await patchRes.text()}`);
    }
    console.log(`Updated PR comment ${existing.id} on #${prNumber}.`);
  } else {
    const postRes = await fetch(`${apiBase}/issues/${prNumber}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body }),
    });
    if (!postRes.ok) {
      throw new Error(`Failed to create PR comment: ${postRes.status} ${await postRes.text()}`);
    }
    console.log(`Created a new PR comment on #${prNumber}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
