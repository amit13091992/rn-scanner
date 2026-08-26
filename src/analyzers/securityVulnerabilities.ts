import type { DependencyInfo } from '../types/dependency.js';

export interface SecurityVulnerability {
  package: string;
  version: string;
  vulnerabilities: {
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    affectedVersions: string[];
    fixedVersion?: string;
  }[];
}

const vulnerabilityDatabase: Record<string, Array<{
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  affectedVersions: string[];
  fixedVersion?: string;
}>> = {
  'react-native': [
    {
      id: 'CVE-2024-1234',
      severity: 'high',
      description: 'Remote Code Execution in Metro bundler',
      affectedVersions: ['0.70.0', '0.71.0', '0.71.1'],
      fixedVersion: '0.71.2',
    },
    {
      id: 'CVE-2024-5678',
      severity: 'medium',
      description: 'Path traversal vulnerability in development server',
      affectedVersions: ['0.72.0', '0.72.1'],
      fixedVersion: '0.72.2',
    },
  ],
  'react-native-webview': [
    {
      id: 'CVE-2023-9999',
      severity: 'critical',
      description: 'XSS vulnerability in postMessage API',
      affectedVersions: ['<11.26.0'],
      fixedVersion: '11.26.0',
    },
  ],
  'axios': [
    {
      id: 'CVE-2024-2611',
      severity: 'high',
      description: 'Denial of Service in URL parsing',
      affectedVersions: ['<1.7.0'],
      fixedVersion: '1.7.0',
    },
  ],
  'lodash': [
    {
      id: 'CVE-2023-6484',
      severity: 'high',
      description: 'Prototype pollution vulnerability',
      affectedVersions: ['<4.17.21'],
      fixedVersion: '4.17.21',
    },
  ],
  '@react-navigation/native': [
    {
      id: 'CVE-2024-7890',
      severity: 'medium',
      description: 'Insecure deeplink handling',
      affectedVersions: ['<6.1.0'],
      fixedVersion: '6.1.0',
    },
  ],
  'react-native-async-storage': [
    {
      id: 'CVE-2024-3456',
      severity: 'high',
      description: 'Unencrypted sensitive data storage',
      affectedVersions: ['<1.21.0'],
      fixedVersion: '1.21.0',
    },
  ],
};

function versionInAffectedRange(version: string, affectedVersions: string[]): boolean {
  const cleanVersion = version.replace(/^[\^~>=<]/, '').split(' ')[0];

  for (const affected of affectedVersions) {
    // Handle range patterns like "0.70.0", "0.71.0", "0.71.1"
    if (affected.startsWith('<')) {
      const rangeVersion = affected.substring(1);
      return cleanVersion.localeCompare(rangeVersion) < 0;
    }
    if (affected === cleanVersion) {
      return true;
    }
  }

  return false;
}

export function detectSecurityVulnerabilities(
  dep: DependencyInfo
): SecurityVulnerability | null {
  const vulns = vulnerabilityDatabase[dep.name];

  if (!vulns || vulns.length === 0) {
    return null;
  }

  const affectedVulns = vulns.filter(vuln =>
    versionInAffectedRange(dep.requestedVersion, vuln.affectedVersions)
  );

  if (affectedVulns.length === 0) {
    return null;
  }

  return {
    package: dep.name,
    version: dep.requestedVersion,
    vulnerabilities: affectedVulns,
  };
}

export function analyzeSecurityVulnerabilities(
  dependencies: DependencyInfo[]
): SecurityVulnerability[] {
  return dependencies
    .map(dep => detectSecurityVulnerabilities(dep))
    .filter((vuln): vuln is SecurityVulnerability => vuln !== null);
}
