#!/usr/bin/env node
// Regenerates the minimal ELF64 test fixtures under test-fixtures/elf/. Each is a hand-built
// ELF header + a single PT_LOAD program header with no actual code — enough to exercise
// utils/elf.ts's alignment parsing without needing a real compiled .so.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'test-fixtures', 'elf');
mkdirSync(outDir, { recursive: true });

function buildElf64(pAlign) {
  const headerSize = 64;
  const phdrSize = 56;
  const totalSize = headerSize + phdrSize;
  const buf = Buffer.alloc(totalSize);

  // e_ident
  buf.write('\x7fELF', 0, 'binary');
  buf[4] = 2; // EI_CLASS = ELFCLASS64
  buf[5] = 1; // EI_DATA = little-endian
  buf[6] = 1; // EI_VERSION

  buf.writeUInt16LE(3, 16); // e_type = ET_DYN
  buf.writeUInt16LE(183, 18); // e_machine = EM_AARCH64
  buf.writeUInt32LE(1, 20); // e_version
  buf.writeBigUInt64LE(0n, 24); // e_entry
  buf.writeBigUInt64LE(BigInt(headerSize), 32); // e_phoff
  buf.writeBigUInt64LE(0n, 40); // e_shoff
  buf.writeUInt32LE(0, 48); // e_flags
  buf.writeUInt16LE(headerSize, 52); // e_ehsize
  buf.writeUInt16LE(phdrSize, 54); // e_phentsize
  buf.writeUInt16LE(1, 56); // e_phnum
  buf.writeUInt16LE(0, 58); // e_shentsize
  buf.writeUInt16LE(0, 60); // e_shnum
  buf.writeUInt16LE(0, 62); // e_shstrndx

  const ph = headerSize;
  buf.writeUInt32LE(1, ph + 0); // p_type = PT_LOAD
  buf.writeUInt32LE(5, ph + 4); // p_flags = R+X
  buf.writeBigUInt64LE(0n, ph + 8); // p_offset
  buf.writeBigUInt64LE(0n, ph + 16); // p_vaddr
  buf.writeBigUInt64LE(0n, ph + 24); // p_paddr
  buf.writeBigUInt64LE(BigInt(totalSize), ph + 32); // p_filesz
  buf.writeBigUInt64LE(BigInt(totalSize), ph + 40); // p_memsz
  buf.writeBigUInt64LE(BigInt(pAlign), ph + 48); // p_align

  return buf;
}

writeFileSync(join(outDir, 'aligned.so'), buildElf64(0x4000));
writeFileSync(join(outDir, 'unaligned.so'), buildElf64(0x1000));
writeFileSync(join(outDir, 'truncated.so'), buildElf64(0x4000).subarray(0, 30));
writeFileSync(join(outDir, 'not-elf.so'), Buffer.from('this is not an ELF file'));

console.log(`Wrote ELF fixtures to ${outDir}`);
