// SPDX-License-Identifier: MIT
// File identities and local-only research image preparation; no network access.
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const models = ['hp39gplus', 'hp39gs', 'hp40gs', 'hp48gii', 'hp49gplus', 'hp50g'];
export const capacities = [0x100000, 0x100000, 0x200000, 0x200000, 0x200000, 0x200000];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fixtures = [
  ['a431b5d61af36aeaffec02a395da648b01507c3b5acc9d325f113384483680ff', 'full-nor-dump', [2], 0x100000, 'User HP39gs complete V2 double-read hardware capture'],
  ['fb4a3862a2ba9cf57746f6275e1c56c23719874a323784ff758240de342554d3', 'arm-boot-region', [2], 0x4000, 'User HP39gs captured native boot region'],
  ['3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab', 'full-nor-dump', [5], 0x200000, 'User HP49g+ complete A/B hardware capture'],
  ['54191621b1a104157258fd6190597b53e92050dc3a3d111a2daf295fa7f83e5e', 'arm-boot-region', [5], 0x4000, 'User HP49g+ captured native boot region'],
  ['95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67', 'full-nor-dump', [1], 0x100000, 'HP39g+ D1.55 hardware dump'],
  ['4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937', 'full-nor-dump', [4], 0x200000, 'HP48gII USB-revision full-NOR mirror'],
  ['f46fbfbbd6442bf76bd412e89fc6d3c64850f742f35eca732e3e5b01cf3393c8', 'arm-boot-region', [5], 0x4000, 'HP49g+ archived native boot region'],
  ['dfa544617039e1bff0f62b9f51a943e57ff756d12bb81478de7aec41a5b73a28', 'arm-boot-region', [6], 0x4000, 'HP50g archived native boot region'],
  ['b01c13e24a692f35e6087106d58ec205b4696d5b5e35d57f8f94015f8bb1f1ca', 'emulator-rom', [4, 5, 6], 0x200000, 'HP 2.15 Emu48+ ROM, not a physical ARM NOR'],
  ['6e56e35054c06931ef8091403c1fcbde7743a7342e12aaf6082b0257dbe9d7b3', 'firmware-update', [2], 995328, 'HP39gs 2.22 updater'],
  ['6fcf63b4d0cae2e59fa8b24b74052bf33812cbea960294429b1032cb98585f7b', 'firmware-update', [3], 1241088, 'HP40gs 2.22 updater'],
  ['b08235fbf7d6ab3c5ad64b82d3ffe7004f942fafe90d0449ab3b0e5c3b0bc8a0', 'firmware-update', [5, 6], 1294336, 'HP49g+/HP50g 2.15 updater'],
];
export function inspectInput(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes.length > 0x200000)
    throw new Error('Expected 4 bytes to 2 MiB of local firmware data');
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hash = sha256(data), found = fixtures.find(f => f[0] === hash);
  if (found && data.length !== found[3]) throw new Error('Firmware catalog length mismatch');
  const word = data.readUInt32LE(0);
  const reset = ((word & 0xff000000) >>> 0) === 0xea000000 || ((word & 0xff7ff000) >>> 0) === 0xe51ff000;
  const marker = data.subarray(0, 16).toString('latin1');
  const update = ['KINPOHP39G+IMAGE', 'KINPOHP40G+IMAGE', 'KINPOUPDATEIMAGE'].includes(marker);
  const bootHash = data.length >= 0x4000 ? sha256(data.subarray(0, 0x4000)) : null;
  const boot = fixtures.find(f => f[1] === 'arm-boot-region' && f[0] === bootHash);
  return { bytes: data.length, sha256: hash, kind: found?.[1] ?? (update ? 'firmware-update' : 'unidentified'),
    models: found ? found[2].map(id => models[id - 1]) : [], identified_fixture: found?.[4] ?? null,
    plausible_arm_vector: reset, first_word: word.toString(16).padStart(8, '0'),
    update_marker: update ? marker : null, boot_verified: false,
    // A known prefix does not authenticate the rest of a full-size image.
    native_boot_region: boot ? { bytes: 0x4000, sha256: bootHash,
      models: boot[2].map(id => models[id - 1]), identified_fixture: boot[4] } : null };
}
// Consumed only with inspectInput's freshly computed result, never a user JSON.
export function assertModelIdentity(id, source) {
  if (!Number.isInteger(id) || id < 1 || id > 6) throw new Error('Unknown model');
  if (source.models.length && !source.models.includes(models[id - 1])) throw new Error('Known firmware belongs to another model');
  if (source.native_boot_region && !source.native_boot_region.models.includes(models[id - 1]))
    throw new Error('Known native boot region belongs to another model');
}
export function prepareInput(id, bytes, kind) {
  const source = inspectInput(bytes);
  assertModelIdentity(id, source);
  if (kind === 'bootloader') {
    if (source.kind !== 'arm-boot-region' || bytes.length !== 0x4000)
      throw new Error('Boot-only probing requires a hash-pinned, matching native boot region');
    // This is NOT a recovered full dump: all other sectors are explicitly erased.
    const image = Buffer.alloc(capacities[id - 1], 0xff);
    image.set(bytes);
    return { source, image, input_kind: 'boot-region-with-erased-remainder',
      construction: { preserved_region: [0, bytes.length], erased_region: [bytes.length, image.length],
        erased_byte: 255, operating_system_supplied: false, reconstructed_full_dump: false } };
  }
  if (kind !== 'full-nor' || bytes.length !== capacities[id - 1] || !source.plausible_arm_vector)
    throw new Error('Expected exact-capacity ARM NOR; updater and boot-region inputs are different formats');
  return { source, image: Buffer.from(bytes), input_kind: source.kind === 'full-nor-dump' ? 'full-nor-dump' : 'unverified-full-size-image',
    construction: null };
}
export function parseGpio(text) {
  if (!text) return [];
  const bits = [0, 11, 16, 16, 16, 8, 16, 11], seen = new Set();
  return text.split(',').map(item => {
    const match = /^([B-H]):([0-9a-f]{1,8}):([0-9a-f]{1,8})$/i.exec(item);
    if (!match) throw new Error('GPIO stimuli use PORT:KNOWN_HEX:LEVELS_HEX, separated by commas');
    const name = match[1].toUpperCase(), port = name.charCodeAt(0) - 65;
    const known = parseInt(match[2], 16), levels = parseInt(match[3], 16);
    if (seen.has(port) || (known & ~((1 << bits[port]) - 1)) || (levels & ~known))
      throw new Error('Duplicate GPIO port, out-of-range mask, or levels outside known mask');
    seen.add(port);
    return { port, name, known, levels, cli: `${name}:${known.toString(16)}:${levels.toString(16)}` };
  }).sort((a, b) => a.port - b.port);
}

export async function readFirmware(path) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 4 || info.size > 0x200000)
      throw new Error('Expected a regular firmware file of 4 bytes to 2 MiB');
    const buffer = Buffer.alloc(info.size + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, used);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used !== info.size) throw new Error('Firmware size changed while reading');
    return buffer.subarray(0, used);
  } finally { await file.close(); }
}

// Research-wrapper budgets are safe JS integers; the native CLI accepts uint64.
export function parseKeyEvents(text, budget) {
  if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('Invalid event budget');
  if (text === undefined) return [];
  if (typeof text !== 'string' || !text.length) throw new Error('Empty key event list');
  const parts = text.split(',');
  if (parts.length > 64) throw new Error('At most 64 key events');
  let previous = -1;
  return parts.map(part => {
    if (!/^\d+:\d+:\d+:\d+$/.test(part)) throw new Error('Expected TICK:COL:ROW:0_OR_1');
    const [tick, column, row, down] = part.split(':').map(Number);
    if (![tick, column, row, down].every(Number.isSafeInteger) || tick < previous || tick >= budget ||
        column >= 8 || row >= 7 || down > 1) throw new Error('Key event outside chronological/bounded range');
    previous = tick;
    return { tick, column, row, down };
  });
}

// Exact, explicit ideal sample codes. No inferred voltage or default channel.
export function parseAdc(text) {
  if (text === undefined) return [];
  if (typeof text !== 'string' || !text) throw new Error('Empty ADC input list');
  const seen = new Set();
  return text.split(',').map(item => {
    const match = /^([0-7]):([0-9]{1,4})$/.exec(item);
    if (!match) throw new Error('Expected decimal CHANNEL:CODE (0..7:0..1023)');
    const channel = Number(match[1]), code = Number(match[2]);
    if (code > 1023 || seen.has(channel)) throw new Error('ADC code out of range or duplicate channel');
    seen.add(channel);
    return { channel, code };
  }).sort((a, b) => a.channel - b.channel);
}

// Bounded local research only; a completed budget does not certify OS boot.
export function parseProbeBudget(text = '1000000') {
  const budget = Number(text);
  if (typeof text !== 'string' || !/^\d+$/.test(text) || !Number.isSafeInteger(budget) ||
      budget < 1 || budget > 500000000)
    throw new Error('Tick budget must be an integer between 1 and 500000000');
  return budget;
}
