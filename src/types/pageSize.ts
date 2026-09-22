export interface NativeLibraryAlignment {
  /** Path to the .so, relative to cwd */
  path: string;
  abi: string;
  is16kAligned: boolean;
  maxLoadAlign: number;
}

export type PageSizeStatus = 'aligned' | 'unaligned' | 'not-checked';

/**
 * Why a package landed at `status: 'not-checked'` — distinct causes that all collapsed into
 * one ambiguous status before this field existed:
 * - `no_native_libraries`: no prebuilt `.so` files found under the ABIs this check inspects
 *   (arm64-v8a/x86_64) — most likely a JS-only package, or one that compiles native code from
 *   source during the Android build rather than shipping a prebuilt binary. Not evidence of a
 *   problem; there's simply nothing on disk yet to inspect.
 * - `unreadable_library`: `.so` file(s) were found but couldn't be read or their ELF program
 *   headers couldn't be parsed (corrupt/truncated file, or a format this parser doesn't
 *   recognize) — alignment genuinely could not be determined.
 */
export type PageSizeNotCheckedReason = 'no_native_libraries' | 'unreadable_library';

export interface PageSizeCheckResult {
  package: string;
  version: string;
  libraries: NativeLibraryAlignment[];
  status: PageSizeStatus;
  /** Present only when status is 'not-checked' — see PageSizeNotCheckedReason. */
  notCheckedReason?: PageSizeNotCheckedReason;
}
