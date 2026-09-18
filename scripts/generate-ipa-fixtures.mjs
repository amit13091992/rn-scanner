#!/usr/bin/env node
// Regenerates the tiny .ipa test fixtures under test-fixtures/ipa/. Each is a real, valid
// zip (built with Node's zlib, no external dependency) containing just enough entries —
// empty placeholder files — to exercise utils/zip.ts's listing and the app-name/dSYM
// detection in detectors/ios/ipaPackage.ts. No actual binary content is needed since this
// check only inspects entry names.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'test-fixtures', 'ipa');
mkdirSync(outDir, { recursive: true });

function buildZip(names) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const name of names) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const content = Buffer.alloc(0);
    const crc = 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression = stored
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18); // compressed size
    localHeader.writeUInt32LE(content.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    const localEntry = Buffer.concat([localHeader, nameBuf, content]);
    localParts.push(localEntry);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central dir signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // compression
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0, 14); // mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // local header offset

    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
    offset += localEntry.length;
  }

  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localSection, centralSection, eocd]);
}

writeFileSync(join(outDir, 'with-dsym.ipa'), buildZip([
  'Payload/MyApp.app/MyApp',
  'Payload/MyApp.app/Info.plist',
  'MyApp.app.dSYM/Contents/Resources/DWARF/MyApp',
]));

writeFileSync(join(outDir, 'without-dsym.ipa'), buildZip([
  'Payload/MyApp.app/MyApp',
  'Payload/MyApp.app/Info.plist',
]));

writeFileSync(join(outDir, 'not-a-zip.ipa'), Buffer.from('this is not a zip file'));

console.log(`Wrote IPA fixtures to ${outDir}`);
