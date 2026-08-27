import type { DependencyInfo, DetectionResult } from '../types/dependency.js';
import { OSVClient } from '../services/osvClient.js';

export interface SecurityFinding {
  package: string;
  version: string;
  vulnerabilities: DetectionResult;
}

let osvClientInstance: OSVClient | null = null;

function getOSVClient(): OSVClient {
  if (!osvClientInstance) {
    osvClientInstance = new OSVClient();
  }
  return osvClientInstance;
}

export async function analyzeSecurityVulnerabilities(
  dependencies: DependencyInfo[]
): Promise<SecurityFinding[]> {
  const osvClient = getOSVClient();

  try {
    const results = await osvClient.fetchVulnerabilities(dependencies);

    return Array.from(results.entries()).map(([packageName, detection]) => {
      const dep = dependencies.find(d => d.name === packageName);
      return {
        package: packageName,
        version: dep?.resolvedVersion || dep?.requestedVersion || '',
        vulnerabilities: detection,
      };
    });
  } catch (error) {
    console.warn(`Security analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return [];
  }
}
