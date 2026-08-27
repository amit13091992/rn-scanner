import type { DependencyInfo, SecurityVulnerabilityData, DetectionResult } from '../types/dependency.js';
import type { OSVBatchQueryRequest, OSVBatchQueryResponse, OSVVulnerability } from '../types/osv.js';
import { versionInRange } from '../utils/versionComparison.js';
import { loadVulnerabilityCache, saveVulnerabilityCache } from '../cache/vulnerabilityCache.js';
import { vulnerabilityFallback } from '../data/vulnerabilityFallback.js';

const OSV_API_URL = 'https://api.osv.dev/v1/batch';
const BATCH_SIZE = 1000;
const REQUEST_TIMEOUT = 10000;

interface CachedVulnerability {
  timestamp: number;
  data: OSVVulnerability[];
}

export class OSVClient {
  private cache: Map<string, CachedVulnerability> = new Map();
  private cacheTTL: number;

  constructor(cacheTTLHours: number = 24) {
    this.cacheTTL = cacheTTLHours * 60 * 60 * 1000;
    this.loadCache();
  }

  private loadCache(): void {
    try {
      const cached = loadVulnerabilityCache();
      Object.entries(cached).forEach(([pkg, data]) => {
        this.cache.set(pkg, data as CachedVulnerability);
      });
    } catch {
      this.cache = new Map();
    }
  }

  private saveCache(): void {
    try {
      const cacheObj: Record<string, CachedVulnerability> = {};
      this.cache.forEach((value, key) => {
        cacheObj[key] = value;
      });
      saveVulnerabilityCache(cacheObj);
    } catch {
    }
  }

  private isCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < this.cacheTTL;
  }

  async fetchVulnerabilities(dependencies: DependencyInfo[]): Promise<Map<string, DetectionResult>> {
    const results = new Map<string, DetectionResult>();

    const packages = dependencies.map(dep => ({
      name: dep.name,
      ecosystem: 'npm',
      version: dep.resolvedVersion || dep.requestedVersion,
    }));

    const uncached = packages.filter(
      dep => !this.cache.has(dep.name) || !this.isCacheValid(this.cache.get(dep.name)!.timestamp)
    );

    if (uncached.length > 0) {
      try {
        const fetched = await this.fetchFromOSV(uncached);

        fetched.forEach((vulns, pkgName) => {
          const timestamp = Date.now();
          this.cache.set(pkgName, { timestamp, data: vulns });
        });

        this.saveCache();
      } catch (error) {
        console.warn(`OSV fetch failed, using fallback: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    dependencies.forEach(dep => {
      const cached = this.cache.get(dep.name);
      const osvVulns = cached?.data || [];

      const matched = this.matchVulnerabilities(
        dep.resolvedVersion || dep.requestedVersion,
        osvVulns
      );

      if (matched.length > 0) {
        results.set(dep.name, {
          vulnerabilities: matched,
          source: cached ? 'cached' : 'osv',
          refreshedAt: cached?.timestamp || Date.now(),
          confidence: 'high',
        });
      }
    });

    return results;
  }

  private async fetchFromOSV(
    packages: Array<{ name: string; ecosystem: string; version: string }>
  ): Promise<Map<string, OSVVulnerability[]>> {
    const results = new Map<string, OSVVulnerability[]>();

    for (let i = 0; i < packages.length; i += BATCH_SIZE) {
      const batch = packages.slice(i, i + BATCH_SIZE);
      const request: OSVBatchQueryRequest = {
        queries: batch.map(pkg => ({
          package: {
            name: pkg.name,
            ecosystem: pkg.ecosystem,
          },
          version: pkg.version,
        })),
      };

      try {
        const response = await this.queryOSV(request);

        if (response?.results) {
          response.results.forEach(result => {
            const pkgName = result.query?.package?.name;
            if (pkgName) {
              results.set(pkgName, result.vulns || []);
            }
          });
        }
      } catch (error) {
        console.warn(`OSV API error: ${error instanceof Error ? error.message : 'Unknown error'}`);

        batch.forEach(pkg => {
          results.set(pkg.name, []);
        });
      }
    }

    return results;
  }

  private async queryOSV(request: OSVBatchQueryRequest): Promise<OSVBatchQueryResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(OSV_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`OSV API returned ${response.status}`);
      }

      return await response.json() as OSVBatchQueryResponse;
    } catch (error) {
      throw new Error(`Failed to fetch from OSV: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private matchVulnerabilities(version: string, osvVulns: OSVVulnerability[]): SecurityVulnerabilityData[] {
    const matched: SecurityVulnerabilityData[] = [];

    osvVulns.forEach(vuln => {
      const affected = vuln.affected?.[0];
      if (!affected) return;

      const inRange = affected.ranges?.some(range =>
        range.events?.some(event => {
          if (event.fixed && !versionInRange(version, `<${event.fixed}`)) {
            return false;
          }
          if (event.introduced && !versionInRange(version, `>=${event.introduced}`)) {
            return false;
          }
          return true;
        })
      ) || affected.versions?.includes(version);

      if (inRange) {
        const severity = vuln.severity?.[0];
        const severityScore = severity?.score ? parseFloat(severity.score) : 0;

        let severityLevel: 'critical' | 'high' | 'medium' | 'low' | 'unknown' = 'unknown';
        if (severityScore >= 9.0) severityLevel = 'critical';
        else if (severityScore >= 7.0) severityLevel = 'high';
        else if (severityScore >= 4.0) severityLevel = 'medium';
        else if (severityScore > 0) severityLevel = 'low';

        matched.push({
          id: vuln.id,
          aliases: vuln.aliases || [],
          severity: severityLevel,
          description: vuln.summary,
          affectedVersions: affected.versions || [],
          published: vuln.published,
          modified: vuln.modified,
          withdrawn: vuln.withdrawn || undefined,
          references: vuln.references?.map(ref => ({
            type: ref.type,
            url: ref.url,
          })) || [],
          source: 'osv',
        });
      }
    });

    return matched;
  }

  getFallbackVulnerabilities(packageName: string, version: string): SecurityVulnerabilityData[] {
    const fallback = vulnerabilityFallback[packageName];
    if (!fallback) {
      return [];
    }

    return fallback.filter(vuln => versionInRange(version, vuln.affectedVersions.join(' ')));
  }
}
