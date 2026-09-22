#!/usr/bin/env node
// Regenerates the tiny .aar test fixtures under test-fixtures/aar/. Each is a real, valid zip
// (built with Node's zlib, no external dependency) containing a jni/<abi>/*.so entry — the AAR
// packaging layout detectors/pageSize.ts's findLibrariesInArchive reads, as opposed to the
// loose jniLibs/<abi>/*.so layout the plain filesystem walk already covered. Reuses the real
// ELF fixture bytes from test-fixtures/elf/ so parseElfAlignment sees genuine content, one
// entry stored (uncompressed) and one DEFLATE-compressed, to exercise both zip code paths in
// utils/zip.ts's readZipEntry.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'test-fixtures', 'aar');
const elfDir = join(__dirname, '..', 'test-fixtures', 'elf');
mkdirSync(outDir, { recursive: true });

const STORED = 0;
const DEFLATE = 8;

function buildZip(entries) {
  // entries: [{ name, content, method }]
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, content, method } of entries) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const stored = method === DEFLATE ? deflateRawSync(content) : content;
    const crc = 0; // readZipEntry doesn't verify CRC, so a placeholder is fine here

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(stored.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localEntry = Buffer.concat([localHeader, nameBuf, stored]);
    localParts.push(localEntry);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(stored.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
    offset += localEntry.length;
  }

  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localSection, centralSection, eocd]);
}

const aligned = readFileSync(join(elfDir, 'aligned.so'));
const unaligned = readFileSync(join(elfDir, 'unaligned.so'));

writeFileSync(
  join(outDir, 'with-native-lib.aar'),
  buildZip([
    { name: 'jni/arm64-v8a/libfoo.so', content: aligned, method: STORED },
    { name: 'jni/x86_64/libfoo.so', content: unaligned, method: DEFLATE },
    { name: 'AndroidManifest.xml', content: Buffer.from('<manifest/>'), method: STORED },
  ]),
);

writeFileSync(
  join(outDir, 'no-native-lib.aar'),
  buildZip([{ name: 'AndroidManifest.xml', content: Buffer.from('<manifest/>'), method: STORED }]),
);

console.log(`Wrote AAR fixtures to ${outDir}`);
