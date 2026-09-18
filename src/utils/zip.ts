const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;

export interface ZipEntry {
  name: string;
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

      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);

      const nameStart = offset + 46;
      const nameEnd = nameStart + nameLength;
      if (nameEnd > buffer.length) return null;

      entries.push({ name: buffer.toString('utf-8', nameStart, nameEnd) });

      offset = nameEnd + extraLength + commentLength;
    }

    return entries;
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
