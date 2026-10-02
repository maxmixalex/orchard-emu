// SPDX-License-Identifier: MIT
// Read-only identity helper. No ROM downloads, extraction, patching, or uploads.
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const path = process.argv[2];
if (!path || process.argv.length !== 3) {
  console.error('Usage: node tools/rom-info.mjs FULL-NOR.bin');
  process.exit(64);
}
const file = await open(path, 'r');
try {
  const size = (await file.stat()).size;
  if (![0x100000, 0x200000].includes(size)) throw new Error('Expected a 1 MiB or 2 MiB full physical NOR');
  const data = await file.readFile();
  if (data.length !== size) throw new Error('File size changed while reading');
  const word = data.readUInt32LE(0);
  const reset = ((word & 0xff000000) >>> 0) === 0xea000000 ||
    ((word & 0xff7ff000) >>> 0) === 0xe51ff000;
  console.log(JSON.stringify({ size, sha256: createHash('sha256').update(data).digest('hex'),
    reset_word: word.toString(16).padStart(8, '0'), plausible_arm_vector: reset,
    model_authenticated: false, boot_verified: false }, null, 2));
  if (!reset) process.exitCode = 64;
} finally { await file.close(); }
