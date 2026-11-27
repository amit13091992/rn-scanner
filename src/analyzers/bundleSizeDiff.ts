import type {
  BudgetViolation,
  BundleBudget,
  BundleDiffResult,
  BundleSnapshot,
  ModuleDelta,
} from '../types/bundleSize.js';

const KIB = 1024;

function notComparable(reason: string): BundleDiffResult {
  return { status: 'not-comparable', reason, warnings: [], notChecked: [], added: [], removed: [], grown: [], shrunk: [], violations: [] };
}

function incompatibility(base: BundleSnapshot, head: BundleSnapshot): string | null {
  if (base.schemaVersion !== head.schemaVersion) return `schema version differs (${base.schemaVersion} vs ${head.schemaVersion})`;
  if (base.platform !== head.platform) return `platform differs (${base.platform} vs ${head.platform})`;
  const { metroVersion: bm, hermesVersion: bh } = base.toolchain;
  const { metroVersion: hm, hermesVersion: hh } = head.toolchain;
  if (bm !== null && hm !== null && bm !== hm) return `Metro version differs (${bm} vs ${hm})`;
  if (bh !== null && hh !== null && bh !== hh) return `Hermes version differs (${bh} vs ${hh})`;
  return null;
}

const bySizeDesc = (a: ModuleDelta, b: ModuleDelta): number => Math.abs(b.delta) - Math.abs(a.delta) || a.id.localeCompare(b.id);

/**
 * Pure comparison of two snapshots against a budget. Never compares unlike data: any
 * incompatibility yields `not-comparable` so the caller re-measures the base instead.
 */
export function diffBundleSnapshots(base: BundleSnapshot, head: BundleSnapshot, budget: BundleBudget = {}): BundleDiffResult {
  const reason = incompatibility(base, head);
  if (reason) return notComparable(reason);

  const warnings: string[] = [];
  if (base.toolchain.metroVersion === null || head.toolchain.metroVersion === null) warnings.push('Metro version unknown on at least one side; toolchain drift cannot be ruled out');
  if (base.toolchain.hermesVersion === null || head.toolchain.hermesVersion === null) warnings.push('Hermes version unknown on at least one side; toolchain drift cannot be ruled out');

  const baseMap = new Map(base.modules.map((m) => [m.id, m.bytes]));
  const headMap = new Map(head.modules.map((m) => [m.id, m.bytes]));
  const added: ModuleDelta[] = [];
  const removed: ModuleDelta[] = [];
  const grown: ModuleDelta[] = [];
  const shrunk: ModuleDelta[] = [];

  for (const [id, headBytes] of headMap) {
    const baseBytes = baseMap.get(id);
    if (baseBytes === undefined) added.push({ id, baseBytes: 0, headBytes, delta: headBytes });
    else if (headBytes > baseBytes) grown.push({ id, baseBytes, headBytes, delta: headBytes - baseBytes });
    else if (headBytes < baseBytes) shrunk.push({ id, baseBytes, headBytes, delta: headBytes - baseBytes });
  }
  for (const [id, baseBytes] of baseMap) {
    if (!headMap.has(id)) removed.push({ id, baseBytes, headBytes: 0, delta: -baseBytes });
  }
  for (const list of [added, removed, grown, shrunk]) list.sort(bySizeDesc);

  const hbc = base.totals.hbcBytes !== null && head.totals.hbcBytes !== null
    ? { base: base.totals.hbcBytes, head: head.totals.hbcBytes, delta: head.totals.hbcBytes - base.totals.hbcBytes }
    : null;
  const js = { base: base.totals.jsBytes, head: head.totals.jsBytes, delta: head.totals.jsBytes - base.totals.jsBytes };

  const violations: BudgetViolation[] = [];
  const notChecked: string[] = [];

  if (budget.totalJsKb !== undefined && head.totals.jsBytes > budget.totalJsKb * KIB) {
    violations.push({ kind: 'totalJs', limitKb: budget.totalJsKb, actualKb: head.totals.jsBytes / KIB });
  }
  if (budget.totalHbcKb !== undefined) {
    if (head.totals.hbcBytes === null) notChecked.push('totalHbcKb: no Hermes bytecode measured on head');
    else if (head.totals.hbcBytes > budget.totalHbcKb * KIB) violations.push({ kind: 'totalHbc', limitKb: budget.totalHbcKb, actualKb: head.totals.hbcBytes / KIB });
  }
  if (budget.perModuleGrowthKb !== undefined) {
    const ignore = budget.ignore ?? [];
    for (const m of [...added, ...grown]) {
      if (ignore.some((p) => m.id.startsWith(p))) continue;
      if (m.delta > budget.perModuleGrowthKb * KIB) {
        violations.push({ kind: 'moduleGrowth', module: m.id, limitKb: budget.perModuleGrowthKb, actualKb: m.delta / KIB });
      }
    }
  }

  return {
    status: violations.length > 0 ? 'over-budget' : 'ok',
    warnings,
    notChecked,
    totals: { js, hbc },
    added,
    removed,
    grown,
    shrunk,
    violations,
  };
}
