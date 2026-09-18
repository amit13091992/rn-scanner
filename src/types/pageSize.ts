export interface NativeLibraryAlignment {
  /** Path to the .so, relative to cwd */
  path: string;
  abi: string;
  is16kAligned: boolean;
  maxLoadAlign: number;
}

export type PageSizeStatus = 'aligned' | 'unaligned' | 'not-checked';

export interface PageSizeCheckResult {
  package: string;
  version: string;
  libraries: NativeLibraryAlignment[];
  status: PageSizeStatus;
}
