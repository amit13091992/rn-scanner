import type { DependencyInfo, DetectionResult } from '../types/dependency.js';
import { OSVClient } from '../services/osvClient.js';

export interface SecurityFinding {
  package: string;
  version: string;
  vulnerabilities: DetectionResult;
}

export interface SecurityAnalysisResult {
  findings: SecurityFinding[];
  error?: { message: string };
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
): Promise<SecurityAnalysisResult> {
  const osvClient = getOSVClient();

  try {
    const results = await osvClient.fetchVulnerabilities(dependencies);

    const findings = Array.from(results.entries()).map(([packageName, detection]) => {
      const dep = dependencies.find(d => d.name === packageName);
      return {
        package: packageName,
        version: dep?.resolvedVersion || dep?.requestedVersion || '',
        vulnerabilities: detection,
      };
    });

    return { findings };
  } catch (error) {
    return {
      findings: [],
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}
