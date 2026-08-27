import type { ParsedLockfile, ResolvedDependency, ILockfileParser, PackageManager } from '../types/lockfile.js';

interface NPMLockContent {
  version?: number;
  lockfileVersion?: number;
  packages?: Record<string, NPMLockPackage>;
  dependencies?: Record<string, { version: string; resolved?: string; integrity?: string }>;
}

interface NPMLockPackage {
  version: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export class NPMLockParser implements ILockfileParser {
  supports(): boolean {
    return true;
  }

  parse(content: string): ParsedLockfile {
    try {
      const parsed: NPMLockContent = JSON.parse(content);
      const lockfileVersion = parsed.lockfileVersion || parsed.version || 1;
      const dependencies = new Map<string, ResolvedDependency>();

      if (lockfileVersion >= 2) {
        this.parseV2orV3(parsed, dependencies);
      } else {
        this.parseV1(parsed, dependencies);
      }

      return {
        manager: 'npm',
        dependencies,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        manager: 'npm',
        dependencies: new Map(),
        timestamp: Date.now(),
      };
    }
  }

  private parseV1(lockContent: NPMLockContent, deps: Map<string, ResolvedDependency>): void {
    const depsObj = lockContent.dependencies || {};

    Object.entries(depsObj).forEach(([name, spec]) => {
      if (typeof spec === 'object' && spec !== null) {
        const version = spec.version || '';
        const resolved = spec.resolved || '';

        deps.set(name, {
          name,
          requestedVersion: version,
          resolvedVersion: resolved || version,
          integrity: spec.integrity,
        });
      }
    });
  }

  private parseV2orV3(lockContent: NPMLockContent, deps: Map<string, ResolvedDependency>): void {
    const packages = lockContent.packages || {};

    Object.entries(packages).forEach(([path, pkg]) => {
      if (!pkg.version) return;

      const name = this.extractPackageName(path);
      if (!name) return;

      const existing = deps.get(name);
      if (existing && existing.requestedVersion === pkg.version) {
        return;
      }

      deps.set(name, {
        name,
        requestedVersion: pkg.version,
        resolvedVersion: pkg.resolved || pkg.version,
        integrity: pkg.integrity,
      });
    });
  }

  private extractPackageName(path: string): string {
    if (path === '') return '';

    const segments = path.split('/').filter(s => s.length > 0);
    if (segments.length === 0) return '';

    if (segments[0].startsWith('@')) {
      return segments.slice(0, 2).join('/');
    }

    return segments[0];
  }
}
