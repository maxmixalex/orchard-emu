// SPDX-License-Identifier: MIT
// Benchmark-only canonicalization of the explicit v1 -> v2 checkpoint migration.
// It preserves every old byte and every v2 SDI byte; it is not a state loader.
const HEADER = 32, V1_RAM_OFFSET = 4070, SDI_BYTES = 52, BOOT_SRAM_BYTES = 4096;
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
  if (!MAGIC.every((byte, i) => byte === bytes[i]) || ![1, 2].includes(version) ||
      model < 1 || model > 6 || view.getUint32(12, true) !== bytes.length ||
      view.getUint32(24, true) !== RAM_BYTES[model] ||
      bytes.length !== V1_RAM_OFFSET + (version === 2 ? SDI_BYTES : 0) + RAM_BYTES[model] + BOOT_SRAM_BYTES ||
      view.getUint32(28, true) !== crc32(bytes.subarray(HEADER)))
    throw Error('Invalid checkpoint layout or checksum');
  if (version === 2) return bytes.slice();
  const canonical = new Uint8Array(bytes.length + SDI_BYTES);
  canonical.set(bytes.subarray(0, V1_RAM_OFFSET));
  canonical.set(bytes.subarray(V1_RAM_OFFSET), V1_RAM_OFFSET + SDI_BYTES);
  const out = new DataView(canonical.buffer);
  out.setUint32(8, 2, true);
  out.setUint32(12, canonical.length, true);
  // SDIDTIMER is the only nonzero empty-slot reset scalar.
  out.setUint32(V1_RAM_OFFSET + 5 * 4, 0x2000, true);
  out.setUint32(28, crc32(canonical.subarray(HEADER)), true);
  return canonical;
}
