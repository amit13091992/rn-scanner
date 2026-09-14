import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function readFileSafe(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function findXcodeprojDir(cwd: string): string | null {
  const iosDir = join(cwd, 'ios');
  if (!existsSync(iosDir)) return null;

  try {
    const entries = readdirSync(iosDir);
    const xcodeproj = entries.find((entry) => entry.endsWith('.xcodeproj'));
    return xcodeproj ? join(iosDir, xcodeproj) : null;
  } catch {
    return null;
  }
}

export interface XcodeHint {
  /** Best-effort Xcode version derived from LastUpgradeCheck, if confidently parseable. */
  version: string | null;
  /** IPHONEOS_DEPLOYMENT_TARGET found directly in project.pbxproj, if any. */
  deploymentTarget: string | null;
}

/**
 * Reads ios/*.xcodeproj/project.pbxproj for indirect Xcode version hints
 * (LastUpgradeCheck) and any IPHONEOS_DEPLOYMENT_TARGET set there.
 *
 * LastUpgradeCheck is an indirect signal (the Xcode version that last touched
 * the project, encoded as a 4-digit number, e.g. 1430 -> roughly Xcode 14.3)
 * and is not a reliable stand-in for the Xcode version actually installed on
 * the machine, so callers should treat a derived value as best-effort only.
 */
export function detectXcodeHints(cwd: string): XcodeHint {
  const projectDir = findXcodeprojDir(cwd);
  if (!projectDir) return { version: null, deploymentTarget: null };

  const content = readFileSafe(join(projectDir, 'project.pbxproj'));
  if (!content) return { version: null, deploymentTarget: null };

  let version: string | null = null;
  const lastUpgradeMatch = content.match(/LastUpgradeCheck\s*=\s*(\d{3,4});/);
  if (lastUpgradeMatch) {
    const raw = lastUpgradeMatch[1];
    // e.g. "1430" -> "14.3", "1500" -> "15.0"
    if (raw.length === 4) {
      const major = raw.slice(0, 2);
      const minor = raw.slice(2).replace(/0+$/, '') || '0';
      version = `${parseInt(major, 10)}.${minor}`;
    } else if (raw.length === 3) {
      const major = raw.slice(0, 1);
      const minor = raw.slice(1).replace(/0+$/, '') || '0';
      version = `${parseInt(major, 10)}.${minor}`;
    }
  }

  const deploymentMatch = content.match(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*([\d.]+);/);
  const deploymentTarget = deploymentMatch ? deploymentMatch[1] : null;

  return { version, deploymentTarget };
}

export interface SwiftVersionHint {
  status: 'unknown';
  reason: string;
}

/**
 * Swift version is provided by the Xcode toolchain and is not declared
 * explicitly in most React Native projects, so this always reports 'unknown'
 * rather than attempting to infer a value.
 */
export function detectSwiftVersionHint(): SwiftVersionHint {
  return {
    status: 'unknown',
    reason: 'Swift version is Xcode-provided and not declared in most React Native projects',
  };
}
