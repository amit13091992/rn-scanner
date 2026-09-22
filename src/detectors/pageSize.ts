import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { resolveDependencyRoot } from '../utils/projectRoot.js';
import { listZipEntries, readZipEntry } from '../utils/zip.js';

export interface NativeLibraryFile {
  /** Absolute path to the .so file, or to the .aar/.jar archive it lives inside for a
   *  zip-packaged entry (see zipEntryName) */
  absolutePath: string;
  /** ABI directory name it was found under, e.g. arm64-v8a */
  abi: string;
  /** Set when this library was found inside a zip archive (.aar/.jar) rather than as a loose
   *  file — analyzers/pageSize.ts must read `bytes` directly in that case, since there's no
   *  standalone filesystem path to the .so itself. */
  zipEntryName?: string;
  /** Already-decompressed file content — only present for a zip-packaged entry. */
  bytes?: Buffer;
}

const ARCHIVE_EXTENSIONS = new Set(['.aar', '.jar']);

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

    if (!entry.isFile()) continue;

    if (entry.name.endsWith('.so')) {
      const segments = fullPath.split(sep);
      const jniIdx = segments.findLastIndex((s) => JNI_DIR_NAMES.has(s));
      if (jniIdx === -1 || jniIdx + 1 >= segments.length) continue;

      const abi = segments[jniIdx + 1];
      if (!RELEVANT_ABIS.has(abi)) continue;

      results.push({ absolutePath: fullPath, abi });
      continue;
    }

    const extIdx = entry.name.lastIndexOf('.');
    if (extIdx === -1 || !ARCHIVE_EXTENSIONS.has(entry.name.slice(extIdx))) continue;

    findLibrariesInArchive(fullPath, results);
  }
}

/**
 * A prebuilt native module commonly ships its `.so` files packaged inside an `.aar` (itself a
 * zip archive), not as loose files under node_modules — the plain filesystem walk above never
 * sees these. Reuses utils/zip.ts (already built for reading zip-based iOS artifacts) rather
 * than adding a new dependency; entries live at `jni/<abi>/*.so` inside the archive (AAR's own
 * internal convention, distinct from the jniLibs/ output directory name Android build tools
 * use once extracted).
 */
function findLibrariesInArchive(archivePath: string, results: NativeLibraryFile[]): void {
  let buffer: Buffer;
  try {
    buffer = readFileSync(archivePath);
  } catch {
    return;
  }

  const entries = listZipEntries(buffer);
  if (!entries) return;

  for (const zipEntry of entries) {
    const segments = zipEntry.name.split('/');
    const jniIdx = segments.findLastIndex((s) => JNI_DIR_NAMES.has(s));
    if (jniIdx === -1 || jniIdx + 1 >= segments.length) continue;
    if (!zipEntry.name.endsWith('.so')) continue;

    const abi = segments[jniIdx + 1];
    if (!RELEVANT_ABIS.has(abi)) continue;

    const bytes = readZipEntry(buffer, zipEntry);
    if (!bytes) continue;

    results.push({ absolutePath: archivePath, abi, zipEntryName: zipEntry.name, bytes });
  }
}

/**
 * Finds prebuilt `.so` files a dependency ships under a `jniLibs/<abi>/` or `jni/<abi>/`
 * directory (the conventional Android AAR/native-module layout), including ones packaged
 * inside an `.aar`/`.jar` archive (see findLibrariesInArchive). Only covers binaries already
 * present post-install — a module that compiles from source during the Android build
 * (CMakeLists.txt/NDK) has no `.so` to inspect until that build runs.
 *
 * No dedup between a loose `.so` and the same library also present inside an archive in the
 * same package tree — both are reported. In practice a package ships one form or the other,
 * not both, so this is a theoretical double-count rather than an observed one; a package that
 * did ship both would need its own (unaligned) copy to actually change the aggregate status,
 * which is arguably still a real thing worth flagging rather than silently deduped away.
 */
export function findNativeLibraries(cwd: string, packageName: string): NativeLibraryFile[] {
  const packageDir = join(resolveDependencyRoot(cwd), 'node_modules', packageName);
  if (!existsSync(packageDir)) return [];

  const results: NativeLibraryFile[] = [];
  walk(packageDir, 0, results);
  return results;
}

export function toRelativePath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath);
}
