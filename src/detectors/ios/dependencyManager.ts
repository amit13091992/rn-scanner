import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type IosDependencyManagerResult = {
  cocoapods: boolean;
  swiftPackageManager: boolean;
};

function readFileSafe(filePath: string): string | null {
  try {
    return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
  } catch {
    return null;
  }
}

function listDirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Reports which native dependency managers an ios/ directory uses: CocoaPods (a Podfile) and/or
 * Swift Package Manager (a package reference in any .xcodeproj's project.pbxproj). Static file
 * checks only; both can be true during a CocoaPods-to-SwiftPM migration.
 */
export function detectIosDependencyManagers(cwd: string): IosDependencyManagerResult {
  const iosDir = join(cwd, 'ios');
  const cocoapods = existsSync(join(iosDir, 'Podfile'));

  const swiftPackageManager = listDirSafe(iosDir)
    .filter((entry) => entry.endsWith('.xcodeproj'))
    .some((proj) => {
      const pbxproj = readFileSafe(join(iosDir, proj, 'project.pbxproj'));
      return pbxproj !== null && /XC(Remote|Local)SwiftPackageReference/.test(pbxproj);
    });

  return { cocoapods, swiftPackageManager };
}
