export interface OSVVulnerability {
  schema_version: string;
  id: string;
  published: string;
  modified: string;
  withdrawn?: string | null;
  aliases: string[];
  summary: string;
  details: string;
  affected: OSVAffected[];
  references: OSVReference[];
  credits?: OSVCredit[];
  severity?: Array<{ type: string; score: string }>;
}

export interface OSVAffected {
  package: {
    ecosystem: string;
    name: string;
  };
  ranges: Array<{
    type: string;
    events: Array<{
      introduced?: string;
      fixed?: string;
      limit?: string;
    }>;
  }>;
  versions?: string[];
  database_specific?: Record<string, unknown>;
}

export interface OSVReference {
  type: string;
  url: string;
}

export interface OSVCredit {
  name: string;
  contact?: string[];
}

export interface OSVCacheEntry {
  vulnerabilities: OSVVulnerability[];
  timestamp: number;
  ttl: number;
}

export type OSVCache = Record<string, OSVCacheEntry>;

export interface OSVQueryRequest {
  package: {
    name: string;
    ecosystem: string;
  };
  version: string;
}

export interface OSVQueryResponse {
  vulns: OSVVulnerability[];
}

export interface OSVBatchQueryRequest {
  queries: OSVQueryRequest[];
}

export interface OSVBatchQueryResponse {
  results: Array<{
    query?: OSVQueryRequest;
    vulns: OSVVulnerability[];
  }>;
}
