import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { DependencyInfo, DependencyType } from '../types/dependency.js';

interface PackageJsonContent {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export function readPackageJson(cwd: string = process.cwd()): PackageJsonContent {
  try {
    const packageJsonPath = resolve(cwd, 'package.json');
    const content = readFileSync(packageJsonPath, 'utf-8');
    return JSON.parse(content) as PackageJsonContent;
  } catch (error) {
    throw new Error(
      `Failed to read package.json: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export function getAllDependencies(
  packageJson: PackageJsonContent
): DependencyInfo[] {
  const deps: DependencyInfo[] = [];

  const addDeps = (
    depObj: Record<string, string> | undefined,
    type: DependencyType
  ) => {
    if (!depObj) return;

    Object.entries(depObj).forEach(([name, version]) => {
      deps.push({
        name,
        requestedVersion: version,
        type,
      });
    });
  };

  addDeps(packageJson.dependencies, 'dependency');
  addDeps(packageJson.devDependencies, 'devDependency');
  addDeps(packageJson.peerDependencies, 'peerDependency');
  addDeps(packageJson.optionalDependencies, 'optionalDependency');

  return deps;
}

export function getSpecificDependency(
  packageJson: PackageJsonContent,
  packageName: string
): string | undefined {
  return (
    packageJson.dependencies?.[packageName] ||
    packageJson.devDependencies?.[packageName] ||
    packageJson.peerDependencies?.[packageName] ||
    packageJson.optionalDependencies?.[packageName]
  );
}
