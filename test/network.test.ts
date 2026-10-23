import { test } from 'node:test';
import { strict as assert } from 'node:assert';


test('readEnv - prefers RN_PREFLIGHT_* and falls back to the pre-rename RN_DEP_SCANNER_*', async () => {
  const { readEnv } = await import('../src/utils/network.js');
  delete process.env.RN_PREFLIGHT_TIMEOUT_MS;
  process.env.RN_DEP_SCANNER_TIMEOUT_MS = '111';
  assert.equal(readEnv('TIMEOUT_MS'), '111');
  process.env.RN_PREFLIGHT_TIMEOUT_MS = '222';
  assert.equal(readEnv('TIMEOUT_MS'), '222');
  delete process.env.RN_PREFLIGHT_TIMEOUT_MS;
  delete process.env.RN_DEP_SCANNER_TIMEOUT_MS;
});
