import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { detectXcodeHints } from './xcode.js';

function readFileSafe(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export type DeploymentTargetSource = 'podfile' | 'xcconfig' | 'xcodeproj' | 'unknown';

export interface DeploymentTargetInfo {
  version: string | null;
  source: DeploymentTargetSource;
}

function detectFromPodfile(cwd: string): string | null {
  const content = readFileSafe(join(cwd, 'ios', 'Podfile'));
  if (!content) return null;

  const match = content.match(/platform\s+:ios,\s*['"]([\d.]+)['"]/);
  return match ? match[1] : null;
}

function findXcconfigFiles(cwd: string): string[] {
  const iosDir = join(cwd, 'ios');
  if (!existsSync(iosDir)) return [];

  const results: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'Pods' || entry === 'build') continue;
      const full = join(dir, entry);
      if (entry.endsWith('.xcconfig')) {
        results.push(full);
        continue;
      }
      // recurse into directories (best-effort, cheap depth check above)
      try {
        if (statSync(full).isDirectory()) walk(full, depth + 1);
      } catch {
        // ignore
      }
    }
  };
  walk(iosDir, 0);
  return results;
}

function detectFromXcconfig(cwd: string): string | null {
  const files = findXcconfigFiles(cwd);
  for (const file of files) {
    const content = readFileSafe(file);
    if (!content) continue;
    const match = content.match(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*([\d.]+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Determines the iOS deployment target, preferring the Podfile's
 * `platform :ios, 'X.Y'` declaration when present, then falling back to
 * .xcconfig files, then to any value found directly in project.pbxproj.
 */
export function detectDeploymentTarget(cwd: string): DeploymentTargetInfo {
  const fromPodfile = detectFromPodfile(cwd);
  if (fromPodfile) return { version: fromPodfile, source: 'podfile' };

  const fromXcconfig = detectFromXcconfig(cwd);
  if (fromXcconfig) return { version: fromXcconfig, source: 'xcconfig' };

  const hints = detectXcodeHints(cwd);
  if (hints.deploymentTarget) return { version: hints.deploymentTarget, source: 'xcodeproj' };

  return { version: null, source: 'unknown' };
}
