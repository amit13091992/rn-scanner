import { randomUUID } from 'node:crypto';
import type { DependencyGraph } from '../types/dependencyGraph.js';
import { SPDX_LICENSE_IDS } from '../data/spdxLicenseIds.js';
import type { CycloneDxBom, CycloneDxComponent, CycloneDxHash, CycloneDxVulnerability } from '../types/sbom.js';
import type { PackageVulnerabilityResult } from '../types/vulnerability.js';

export function npmPurl(name: string, version: string): string {
  const scoped = /^@([^/]+)\/(.+)$/.exec(name);
  // purl spec: the scope's "@" is percent-encoded when it is the namespace.
  return scoped ? `pkg:npm/%40${scoped[1]}/${scoped[2]}@${version}` : `pkg:npm/${name}@${version}`;
}

function splitName(name: string): { group?: string; name: string } {
  const scoped = /^(@[^/]+)\/(.+)$/.exec(name);
  return scoped ? { group: scoped[1]!, name: scoped[2]! } : { name };
}

const SPDX_BY_LOWERCASE = new Map(SPDX_LICENSE_IDS.map((id) => [id.toLowerCase(), id]));

/**
 * npm's free-form `license` string mapped onto CycloneDX's three shapes: a token that is a real
 * SPDX identifier (matched case-insensitively and emitted in canonical case) is an `id`, a
 * compound SPDX expression (`(MIT OR Apache-2.0)`) is an `expression`, and anything else
 * (`BSD`, `UNLICENSED`, `SEE LICENSE IN ...`, prose) is a free-text `name` — emitting those as
 * `id` makes the document fail schema validation. Identifiers inside an expression are not
 * individually checked.
 */
export function toCycloneDxLicense(raw: string): NonNullable<CycloneDxComponent['licenses']>[number] {
  const value = raw.trim();
  if (/^\(?[A-Za-z0-9.+-]+(\s+(OR|AND|WITH)\s+[A-Za-z0-9.+-]+)+\)?$/.test(value)) return { expression: value };
  const canonical = SPDX_BY_LOWERCASE.get(value.toLowerCase());
  return canonical ? { license: { id: canonical } } : { license: { name: value } };
}

export interface SbomInput {
  graph: DependencyGraph;
  app: { name: string; version: string };
  tool: { name: string; version: string };
  licenseOf: (packageName: string) => string | null;
  hashes?: Map<string, CycloneDxHash>;
  vulnerabilities?: PackageVulnerabilityResult[];
  now?: Date;
  serialNumber?: string;
}

const SEVERITY: Record<string, CycloneDxVulnerability['ratings'][number]['severity']> = {
  critical: 'critical',
  high: 'high',
  moderate: 'medium',
  low: 'low',
  unknown: 'unknown',
};

function buildVulnerabilities(results: PackageVulnerabilityResult[]): CycloneDxVulnerability[] {
  const byId = new Map<string, CycloneDxVulnerability & { fixes: string[] }>();

  for (const pkg of results) {
    const ref = npmPurl(pkg.package, pkg.version);
    for (const v of pkg.vulnerabilities) {
      let entry = byId.get(v.id);
      if (!entry) {
        const ours = v.id.startsWith('RNDS-');
        const urls = v.references.filter((r) => /^https?:\/\//.test(r));
        entry = {
          id: v.id,
          source: ours ? { name: 'rn-dep-scanner' } : { name: 'OSV', url: `https://osv.dev/vulnerability/${v.id}` },
          ratings: [{ severity: SEVERITY[v.severity] ?? 'unknown' }],
          description: v.summary,
          ...(urls.length > 0 ? { advisories: urls.map((url) => ({ url })) } : {}),
          // Reachability is never assessed here, so every finding is triage-pending rather than
          // exploitable or not_affected (ADR-0004: don't state a conclusion that wasn't reached).
          analysis: { state: 'in_triage', detail: 'Reported for the installed version; not assessed for reachability or exploitability.' },
          affects: [],
          fixes: [],
        };
        byId.set(v.id, entry);
      }
      if (!entry.affects.some((a) => a.ref === ref)) entry.affects.push({ ref });
      if (v.fixedVersion) entry.fixes.push(`${pkg.package}: upgrade to ${v.fixedVersion} or later`);
    }
  }

  return [...byId.values()]
    .map(({ fixes, ...rest }) => ({ ...rest, ...(fixes.length > 0 ? { recommendation: [...new Set(fixes)].join('; ') } : {}) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Builds a CycloneDX 1.6 BOM from the dependency graph: one component per unique installed
 * (name, version) with a purl-based bom-ref, license, dev-only marker and — npm lockfiles only —
 * the registry integrity hash; a `dependencies` section carrying the real edges; and, when
 * `vulnerabilities` is supplied, a VEX-style `vulnerabilities` section. Pure: no I/O.
 */
export function buildCycloneDxBom(input: SbomInput): CycloneDxBom {
  const { graph } = input;
  const components = new Map<string, CycloneDxComponent>();
  const devOnly = new Map<string, boolean>();
  const edges = new Map<string, Set<string>>();

  const refOf = (nodeId: string): string | null => {
    const node = graph.nodes.get(nodeId);
    return node && node.version ? npmPurl(node.name, node.version) : null;
  };

  for (const [nodeId, node] of graph.nodes) {
    if (nodeId === graph.root || !node.version) continue;
    const ref = npmPurl(node.name, node.version);

    devOnly.set(ref, (devOnly.get(ref) ?? true) && node.dev === true);

    if (!components.has(ref)) {
      const license = input.licenseOf(node.name);
      const hash = input.hashes?.get(`${node.name}@${node.version}`);
      components.set(ref, {
        type: 'library',
        'bom-ref': ref,
        ...splitName(node.name),
        version: node.version,
        purl: ref,
        ...(hash ? { hashes: [hash] } : {}),
        ...(license ? { licenses: [toCycloneDxLicense(license)] } : {}),
      });
    }

    const deps = edges.get(ref) ?? new Set<string>();
    for (const childId of node.children) {
      const childRef = refOf(childId);
      if (childRef) deps.add(childRef);
    }
    edges.set(ref, deps);
  }

  const appRef = npmPurl(input.app.name, input.app.version);
  const rootDeps = new Set<string>();
  for (const childId of graph.nodes.get(graph.root)?.children ?? []) {
    const childRef = refOf(childId);
    if (childRef) rootDeps.add(childRef);
  }

  const sortedComponents = [...components.values()]
    .map((c): CycloneDxComponent => {
      const dev = devOnly.get(c['bom-ref']) === true;
      return {
        ...c,
        scope: dev ? 'optional' : 'required',
        ...(dev ? { properties: [{ name: 'cdx:npm:package:development', value: 'true' }] } : {}),
      };
    })
    .sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));

  const dependencies = [
    { ref: appRef, dependsOn: [...rootDeps].sort() },
    ...[...edges.entries()]
      .map(([ref, deps]) => ({ ref, dependsOn: [...deps].sort() }))
      .sort((a, b) => a.ref.localeCompare(b.ref)),
  ];

  return {
    $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: input.serialNumber ?? `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: (input.now ?? new Date()).toISOString(),
      tools: { components: [{ type: 'application', name: input.tool.name, version: input.tool.version }] },
      component: {
        type: 'application',
        'bom-ref': appRef,
        ...splitName(input.app.name),
        version: input.app.version,
        purl: appRef,
      },
    },
    components: sortedComponents,
    dependencies,
    ...(input.vulnerabilities ? { vulnerabilities: buildVulnerabilities(input.vulnerabilities) } : {}),
  };
}
