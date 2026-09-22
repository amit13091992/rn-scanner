import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;

/** Zip compression method 0 (stored, no compression) — the only other method this reader
 *  decompresses is 8 (DEFLATE), via node's built-in zlib; anything else is left unread. */
const COMPRESSION_STORED = 0;
const COMPRESSION_DEFLATE = 8;

export interface ZipEntry {
  name: string;
  /** Present alongside `name` — needed by readZipEntry to locate and decompress this entry's
   *  data. Absent (undefined) only on entries listZipEntries can't fully parse; readZipEntry
   *  returns null for those rather than throwing. */
  compressionMethod?: number;
  compressedSize?: number;
  uncompressedSize?: number;
  localHeaderOffset?: number;
}

/**
 * Lists the file names in a zip archive's central directory — no decompression, since a
 * presence check only needs entry names. Reads the buffer directly (an .ipa/.xcarchive is
 * untrusted repo/build output), returning null rather than throwing for anything malformed
 * or truncated, per the same read-only-on-untrusted-content approach as utils/elf.ts.
 */
export function listZipEntries(buffer: Buffer): ZipEntry[] | null {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset === -1) return null;

  try {
    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

    const entries: ZipEntry[] = [];
    let offset = centralDirOffset;

    for (let i = 0; i < totalEntries; i++) {
      if (offset + 46 > buffer.length) return null;
      if (buffer.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) return null;

      const compressionMethod = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const uncompressedSize = buffer.readUInt32LE(offset + 24);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localHeaderOffset = buffer.readUInt32LE(offset + 42);

      const nameStart = offset + 46;
      const nameEnd = nameStart + nameLength;
      if (nameEnd > buffer.length) return null;

      entries.push({
        name: buffer.toString('utf-8', nameStart, nameEnd),
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });

      offset = nameEnd + extraLength + commentLength;
    }

    return entries;
  } catch {
    return null;
  }
}

/**
 * Extracts and decompresses one entry's file data, given the entry as returned by
 * listZipEntries (needs its localHeaderOffset/compressionMethod/compressedSize fields).
 * Returns null for anything malformed/truncated, or a compression method other than
 * stored/DEFLATE (rare in practice for a zip — no attempt to support it rather than adding a
 * new dependency for it).
 *
 * Deliberately does not validate the entry's CRC-32 — this reader only exists to feed bytes
 * into utils/elf.ts's parseElfAlignment, which already tolerates malformed/truncated input by
 * returning null rather than throwing (same "don't validate exhaustively, just fail safe on
 * untrusted content" contract this file already follows for zip structure itself). Truncated
 * STORED content could in principle produce bytes that happen to still look ELF-ish; treat a
 * result from this function as "best effort", not cryptographically verified.
 */
export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer | null {
  if (
    entry.localHeaderOffset === undefined ||
    entry.compressionMethod === undefined ||
    entry.compressedSize === undefined
  ) {
    return null;
  }

  try {
    const offset = entry.localHeaderOffset;
    if (offset + 30 > buffer.length) return null;
    if (buffer.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) return null;

    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > buffer.length) return null;

    const compressed = buffer.subarray(dataStart, dataEnd);

    if (entry.compressionMethod === COMPRESSION_STORED) {
      return Buffer.from(compressed);
    }
    if (entry.compressionMethod === COMPRESSION_DEFLATE) {
      return inflateRawSync(compressed);
    }
    return null;
  } catch {
    return null;
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  if (buffer.length < EOCD_MIN_SIZE) return -1;

  const searchStart = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_COMMENT_SIZE);
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      return i;
    }
  }
  return -1;
}
