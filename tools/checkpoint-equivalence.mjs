// SPDX-License-Identifier: MIT
// Benchmark-only canonicalization of the explicit v1-v6 -> v7 migration.
// Preserve represented FIFO/media, PCLK/PWM and SPI/reset state.
// This checks the layout/checksum; the core remains the authoritative loader.
const HEADER = 32, V1_RAM_OFFSET = 4070, SDI_BYTES = 52, MEDIA_STATE_BYTES = 709, BOOT_SRAM_BYTES = 4096;
const V3_RAM_OFFSET = V1_RAM_OFFSET + SDI_BYTES + MEDIA_STATE_BYTES;
const PWM_CLOCK_BYTES = 64, V4_RAM_OFFSET = V3_RAM_OFFSET + PWM_CLOCK_BYTES;
const SPI_RESET_BYTES = 76, V5_RAM_OFFSET = V4_RAM_OFFSET + SPI_RESET_BYTES;
const UART_NOR_BYTES=4377,V6_RAM_OFFSET=V5_RAM_OFFSET+UART_NOR_BYTES;
const TLB_BYTES=2056,V7_RAM_OFFSET=V6_RAM_OFFSET+TLB_BYTES;
const MPLLCON_OFFSET = 400, TCMPB_OFFSET = 1903, SD_BYTES_OFFSET = V3_RAM_OFFSET - 6;
const RAM_BYTES = [0, 0x40000, 0x40000, 0x40000, 0x40000, 0x80000, 0x80000];
const FLASH_BYTES=[0,0x100000,0x100000,0x200000,0x200000,0x200000,0x200000];
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
export function canonicalCheckpoint(bytes,{irdaAttached=false}={}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < HEADER)
    throw Error('Invalid checkpoint bytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true), model = view.getUint32(16, true);
  const ramOffset = [0, V1_RAM_OFFSET, V1_RAM_OFFSET + SDI_BYTES, V3_RAM_OFFSET, V4_RAM_OFFSET, V5_RAM_OFFSET,V6_RAM_OFFSET,V7_RAM_OFFSET][version];
  const sdBytes = version >= 3 && bytes.length >= V3_RAM_OFFSET ? view.getUint32(SD_BYTES_OFFSET, true) : 0;
  const patches=version>=6&&bytes.length>=V6_RAM_OFFSET?view.getUint32(V6_RAM_OFFSET-4,true):0;
  if (!MAGIC.every((byte, i) => byte === bytes[i]) || ![1, 2, 3, 4, 5,6,7].includes(version) ||
      model < 1 || model > 6 || view.getUint32(12, true) !== bytes.length ||
      view.getUint32(24, true) !== RAM_BYTES[model] ||
      (sdBytes && (model < 5 || ![1, 2, 4, 8, 16, 32].some(n => sdBytes === n * 1048576))) ||
      patches>FLASH_BYTES[model]/4096||bytes.length !== ramOffset + RAM_BYTES[model] + BOOT_SRAM_BYTES + sdBytes + patches*4100||
      view.getUint32(28, true) !== crc32(bytes.subarray(HEADER)))
    throw Error('Invalid checkpoint layout or checksum');
  if(version>=6){
    const base=ramOffset+RAM_BYTES[model]+BOOT_SRAM_BYTES+sdBytes;let previous=-1;
    for(let i=0;i<patches;i++){const address=view.getUint32(base+i*4100,true);
      if(address%4096||address>=FLASH_BYTES[model]||address<=previous)throw Error('Invalid NOR delta');previous=address;}
    if(version===7)return Uint8Array.from(bytes);
  }
  const canonical = new Uint8Array(bytes.length + V7_RAM_OFFSET - ramOffset);
  canonical.set(bytes.subarray(0, ramOffset));
  canonical.set(bytes.subarray(ramOffset), V7_RAM_OFFSET);
  const out = new DataView(canonical.buffer);
  out.setUint32(8, 7, true);
  out.setUint32(12, canonical.length, true);
  if (version === 1) out.setUint32(V1_RAM_OFFSET + 5 * 4, 0x2000, true);
  if (version < 3) {
    const extension = V1_RAM_OFFSET + SDI_BYTES;
    out.setUint32(extension + 72, 1, true); // Virtual card RCA after protocol reset.
    out.setUint32(extension + 76, 512, true);
    out.setUint32(extension + 80, 1, true);
  }
  // v1-v3 did not record MPLL write history or active compares.
  // Match the documented core migration, without claiming exact reconstruction
  // of an old partial PWM cycle. All new pending and phase fields start at zero.
  if (version < 4) {
    out.setUint32(V3_RAM_OFFSET + 4, view.getUint32(MPLLCON_OFFSET, true) === 0x5c080 ? 0 : 1, true);
    canonical.set(bytes.subarray(TCMPB_OFFSET, TCMPB_OFFSET + 16), V3_RAM_OFFSET + 8);
  }
  // Old formats could not represent SPI transfers or an active reset pulse.
  if(version<5)for (let channel = 0; channel < 2; ++channel) {
    out.setUint32(V4_RAM_OFFSET + channel * 36 + 4, 1, true); // REDY
    out.setUint32(V4_RAM_OFFSET + channel * 36 + 8, 2, true); // SPPIN reserved bit
  }
  // Attachment is an explicit host board choice absent from older formats.
  // Callers comparing an imported hp49-home session can supply that choice;
  // do not silently erase or normalize a represented v6 field.
  if(version<6)canonical[V5_RAM_OFFSET+4332]=Number(Boolean(irdaAttached));
  // v1-v6 had no guest TLB. Migration leaves both banks and c10 zero; an
  // existing v7 mapping/preserve/victim is never normalized away.
  out.setUint32(28, crc32(canonical.subarray(HEADER)), true);
  return canonical;
}
