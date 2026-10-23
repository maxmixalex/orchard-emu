// SPDX-License-Identifier: MIT
// Benchmark-only canonicalization of the explicit v1/v2 -> v3 migration.
// Preserve every old field and every new FIFO/media byte; this is not a loader.
const HEADER = 32, V1_RAM_OFFSET = 4070, SDI_BYTES = 52, MEDIA_STATE_BYTES = 709, BOOT_SRAM_BYTES = 4096;
const V3_RAM_OFFSET = V1_RAM_OFFSET + SDI_BYTES + MEDIA_STATE_BYTES;
const RAM_BYTES = [0, 0x40000, 0x40000, 0x40000, 0x40000, 0x80000, 0x80000];
const MAGIC = new TextEncoder().encode('ORCHST01');
const crcTable = Array.from({length: 256}, (_, i) => {
  let value = i;
  for (let bit = 0; bit < 8; ++bit) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (~value) >>> 0;
}
export function canonicalCheckpoint(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < HEADER)
    throw Error('Invalid checkpoint bytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true), model = view.getUint32(16, true);
  const ramOffset = version === 1 ? V1_RAM_OFFSET : version === 2 ? V1_RAM_OFFSET + SDI_BYTES : V3_RAM_OFFSET;
  const sdBytes = version === 3 && bytes.length >= V3_RAM_OFFSET ? view.getUint32(V3_RAM_OFFSET - 6, true) : 0;
  if (!MAGIC.every((byte, i) => byte === bytes[i]) || ![1, 2, 3].includes(version) ||
      model < 1 || model > 6 || view.getUint32(12, true) !== bytes.length ||
      view.getUint32(24, true) !== RAM_BYTES[model] ||
      (sdBytes && (model < 5 || ![1, 2, 4, 8, 16, 32].some(n => sdBytes === n * 1048576))) ||
      bytes.length !== ramOffset + RAM_BYTES[model] + BOOT_SRAM_BYTES + sdBytes ||
      view.getUint32(28, true) !== crc32(bytes.subarray(HEADER)))
    throw Error('Invalid checkpoint layout or checksum');
  if (version === 3) return bytes.slice();
  const canonical = new Uint8Array(bytes.length + V3_RAM_OFFSET - ramOffset);
  canonical.set(bytes.subarray(0, ramOffset));
  canonical.set(bytes.subarray(ramOffset), V3_RAM_OFFSET);
  const out = new DataView(canonical.buffer);
  out.setUint32(8, 3, true);
  out.setUint32(12, canonical.length, true);
  if (version === 1) out.setUint32(V1_RAM_OFFSET + 5 * 4, 0x2000, true);
  const extension = V1_RAM_OFFSET + SDI_BYTES;
  out.setUint32(extension + 72, 1, true); // Virtual card RCA after protocol reset.
  out.setUint32(extension + 76, 512, true);
  out.setUint32(extension + 80, 1, true);
  out.setUint32(28, crc32(canonical.subarray(HEADER)), true);
  return canonical;
}
