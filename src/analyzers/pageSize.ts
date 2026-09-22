import { readFileSync } from 'node:fs';
import { findNativeLibraries, toRelativePath } from '../detectors/pageSize.js';
import { parseElfAlignment } from '../utils/elf.js';
import type { DependencyInfo } from '../types/dependency.js';
import type { NativeLibraryAlignment, PageSizeCheckResult } from '../types/pageSize.js';

/**
 * Checks every installed dependency's prebuilt `.so` libraries for 16KB page-size alignment
 * (Android 15+ devices, and enforced on some Play Store upload tracks since 2025). A
 * dependency with no `.so` files at all reports 'not-checked' — it either ships no native
 * code or compiles from source during the Android build, neither of which this static check
 * can evaluate.
 */
export function analyzePageSize(cwd: string, dependencies: DependencyInfo[]): PageSizeCheckResult[] {
  const results: PageSizeCheckResult[] = [];

  for (const dep of dependencies) {
    const libraryFiles = findNativeLibraries(cwd, dep.name);
    const version = dep.resolvedVersion || dep.requestedVersion;

    if (libraryFiles.length === 0) {
      results.push({
        package: dep.name,
        version,
        libraries: [],
        status: 'not-checked',
        notCheckedReason: 'no_native_libraries',
      });
      continue;
    }

    const libraries: NativeLibraryAlignment[] = [];
    for (const file of libraryFiles) {
      let buffer: Buffer;
      if (file.bytes) {
        // Already-decompressed bytes from a zip-packaged (.aar/.jar) entry — see
        // detectors/pageSize.ts's findLibrariesInArchive.
        buffer = file.bytes;
      } else {
        try {
          buffer = readFileSync(file.absolutePath);
        } catch {
          continue;
        }
      }

      const alignment = parseElfAlignment(buffer);
      if (!alignment) continue;

      const path = file.zipEntryName
        ? `${toRelativePath(cwd, file.absolutePath)}!${file.zipEntryName}`
        : toRelativePath(cwd, file.absolutePath);

      libraries.push({
        path,
        abi: file.abi,
        is16kAligned: alignment.is16kAligned,
        maxLoadAlign: alignment.maxLoadAlign,
      });
    }

    if (libraries.length === 0) {
      results.push({
        package: dep.name,
        version,
        libraries: [],
        status: 'not-checked',
        notCheckedReason: 'unreadable_library',
      });
      continue;
    }

    const status = libraries.every((lib) => lib.is16kAligned) ? 'aligned' : 'unaligned';
    results.push({ package: dep.name, version, libraries, status });
  }

  return results;
}
