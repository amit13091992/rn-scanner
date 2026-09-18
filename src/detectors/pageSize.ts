import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface NativeLibraryFile {
  /** Absolute path to the .so file */
  absolutePath: string;
  /** ABI directory name it was found under, e.g. arm64-v8a */
  abi: string;
}

const MAX_WALK_DEPTH = 8;
const JNI_DIR_NAMES = new Set(['jniLibs', 'jni']);
// 16KB page-size alignment is an arm64/x86_64 concern only — 32-bit ABIs run fine on 4KB
// pages regardless, so scanning them would just produce a confusing "unaligned" result for
// something that was never at risk.
const RELEVANT_ABIS = new Set(['arm64-v8a', 'x86_64']);

function walk(dir: string, depth: number, results: NativeLibraryFile[]): void {
  if (depth > MAX_WALK_DEPTH) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, depth + 1, results);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.so')) continue;

    const segments = fullPath.split(sep);
    const jniIdx = segments.findLastIndex((s) => JNI_DIR_NAMES.has(s));
    if (jniIdx === -1 || jniIdx + 1 >= segments.length) continue;

    const abi = segments[jniIdx + 1];
    if (!RELEVANT_ABIS.has(abi)) continue;

    results.push({ absolutePath: fullPath, abi });
  }
}

/**
 * Finds prebuilt `.so` files a dependency ships under a `jniLibs/<abi>/` or `jni/<abi>/`
 * directory (the conventional Android AAR/native-module layout). Only covers binaries
 * already present post-install — a module that compiles from source during the Android
 * build (CMakeLists.txt/NDK) has no `.so` to inspect until that build runs.
 */
export function findNativeLibraries(cwd: string, packageName: string): NativeLibraryFile[] {
  const packageDir = join(cwd, 'node_modules', packageName);
  if (!existsSync(packageDir)) return [];

  const results: NativeLibraryFile[] = [];
  walk(packageDir, 0, results);
  return results;
}

export function toRelativePath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath);
}
