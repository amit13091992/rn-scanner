export interface CycloneDxHash {
  alg: 'SHA-512' | 'SHA-384' | 'SHA-256' | 'SHA-1';
  content: string;
}

export interface CycloneDxComponent {
  type: 'library' | 'application';
  'bom-ref': string;
  group?: string;
  name: string;
  version: string;
  purl: string;
  scope?: 'required' | 'optional';
  hashes?: CycloneDxHash[];
  licenses?: Array<{ license: { id: string } } | { license: { name: string } } | { expression: string }>;
  properties?: Array<{ name: string; value: string }>;
}

export interface CycloneDxVulnerability {
  id: string;
  source: { name: string; url?: string };
  ratings: Array<{ severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown' }>;
  description: string;
  recommendation?: string;
  advisories?: Array<{ url: string }>;
  analysis: { state: 'in_triage'; detail: string };
  affects: Array<{ ref: string }>;
}

export interface CycloneDxBom {
  $schema: string;
  bomFormat: 'CycloneDX';
  specVersion: '1.6';
  serialNumber: string;
  version: 1;
  metadata: {
    timestamp: string;
    tools: { components: Array<{ type: 'application'; name: string; version: string }> };
    component: Omit<CycloneDxComponent, 'hashes' | 'licenses' | 'scope' | 'properties'>;
  };
  components: CycloneDxComponent[];
  dependencies: Array<{ ref: string; dependsOn: string[] }>;
  vulnerabilities?: CycloneDxVulnerability[];
}
