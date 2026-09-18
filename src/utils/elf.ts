const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46]; // 0x7F 'E' 'L' 'F'
const PT_LOAD = 1;
const PAGE_SIZE_16K = 0x4000;

export interface ElfAlignmentInfo {
  /** 32 or 64, from EI_CLASS */
  bitness: 32 | 64;
  /** Largest p_align seen across PT_LOAD segments (0 if the file has none) */
  maxLoadAlign: number;
  /** True when every PT_LOAD segment's p_align is >= 16KB */
  is16kAligned: boolean;
}

/**
 * Parses an ELF binary's program header table and reports whether its PT_LOAD segments are
 * aligned for a 16KB memory page size (Android 15+ devices). Reads only the fixed-size ELF
 * header and program header entries — never executes the binary, per the analyzer's
 * read-only-on-untrusted-content requirement (security.md). Returns null for anything that
 * isn't a well-formed ELF file (wrong magic, truncated, or malformed header) rather than
 * throwing, since this may run against arbitrary repo/node_modules content.
 */
export function parseElfAlignment(buffer: Buffer): ElfAlignmentInfo | null {
  if (buffer.length < 20 || !ELF_MAGIC.every((byte, i) => buffer[i] === byte)) {
    return null;
  }

  const eiClass = buffer[4]; // 1 = 32-bit, 2 = 64-bit
  const eiData = buffer[5]; // 1 = little-endian, 2 = big-endian
  if (eiClass !== 1 && eiClass !== 2) return null;
  if (eiData !== 1 && eiData !== 2) return null;

  const bitness: 32 | 64 = eiClass === 2 ? 64 : 32;
  const littleEndian = eiData === 1;

  try {
    // e_phoff, e_phentsize, e_phnum live at different offsets for 32- vs 64-bit ELF headers.
    const phoff = bitness === 64 ? readUint(buffer, 32, 8, littleEndian) : readUint(buffer, 28, 4, littleEndian);
    const phentsize = bitness === 64 ? readUint(buffer, 54, 2, littleEndian) : readUint(buffer, 42, 2, littleEndian);
    const phnum = bitness === 64 ? readUint(buffer, 56, 2, littleEndian) : readUint(buffer, 44, 2, littleEndian);

    if (phoff < 0 || phentsize <= 0 || phnum < 0) return null;
    if (phoff + phentsize * phnum > buffer.length) return null;

    let maxLoadAlign = 0;
    let sawLoadSegment = false;

    for (let i = 0; i < phnum; i++) {
      const entryOffset = phoff + i * phentsize;
      if (entryOffset + 4 > buffer.length) break;
      const pType = readUint(buffer, entryOffset, 4, littleEndian);
      if (pType !== PT_LOAD) continue;

      // p_align offset differs between 32-bit (Elf32_Phdr) and 64-bit (Elf64_Phdr) layouts.
      const alignOffset = bitness === 64 ? entryOffset + 48 : entryOffset + 28;
      if (alignOffset + 8 > buffer.length) continue;

      const align = bitness === 64
        ? readUint(buffer, alignOffset, 8, littleEndian)
        : readUint(buffer, alignOffset, 4, littleEndian);

      sawLoadSegment = true;
      if (align > maxLoadAlign) maxLoadAlign = align;
    }

    if (!sawLoadSegment) return null;

    return {
      bitness,
      maxLoadAlign,
      is16kAligned: maxLoadAlign >= PAGE_SIZE_16K,
    };
  } catch {
    return null;
  }
}

function readUint(buffer: Buffer, offset: number, byteLength: number, littleEndian: boolean): number {
  if (byteLength === 8) {
    const value = littleEndian ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset);
    return Number(value);
  }
  if (byteLength === 4) {
    return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  }
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}
