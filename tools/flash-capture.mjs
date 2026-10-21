// SPDX-License-Identifier: MIT
// Read-only HP49g+ capture programs and local, strict A/B capture assembly.
import { mkdir, readFile, readdir, writeFile, lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectInput, assertModelIdentity } from './rom-inputs.mjs';

export const FLASH_BYTES = 0x200000;
export const CHUNK_BYTES = 0x4000;
const HEADER = Buffer.from('HPHP49-C', 'ascii');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = (n, width) => n.toString(16).toUpperCase().padStart(width, '0');

// HP's documented packed object format. Integers/characters are low-nibble
// first; XLIB identities avoid firmware-specific executable ROM addresses.
function integer(value, width) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 16 ** width)
    throw new Error('Object integer does not fit');
  return hex(value, width).split('').reverse().join('');
}
function characters(text) {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error('Only printable ASCII is generated');
  return [...text].map(c => integer(c.charCodeAt(0), 2)).join('');
}
const string = text => integer(0x02a2c, 5) + integer(5 + text.length * 2, 5) + characters(text);
const binary = value => integer(0x02a4e, 5) + integer(21, 5) + integer(value, 16);
const xlib = (library, command) => integer(0x02e92, 5) + integer(library, 3) + integer(command, 3);
const sdPath = text => integer(0x02afc, 5) + integer(1, 2) + characters('3') + string(text);
function packed(nibbles) {
  const bytes = Buffer.alloc(Math.ceil(nibbles.length / 2));
  for (let i = 0; i < nibbles.length; ++i)
    bytes[i >> 1] |= parseInt(nibbles[i], 16) << ((i & 1) * 4);
  return Buffer.concat([HEADER, bytes]);
}

export function captureName(pass, index) {
  if (!['A', 'B'].includes(pass) || !Number.isInteger(index) || index < 0 || index >= FLASH_BYTES / CHUNK_BYTES)
    throw new Error('Invalid capture pass or chunk index');
  return `OR49${pass}${index.toString().padStart(3, '0')}`;
}

export function buildReadProgram(pass = 'A', { probe = false, storeProbe = false } = {}) {
  if (!['A', 'B'].includes(pass)) throw new Error('Invalid capture pass');
  if (storeProbe && !probe) throw new Error('Only the short probe can use the probe destination');
  let body = integer(0x02d9d, 5);
  const source = ['«'];
  const chunks = probe ? 1 : FLASH_BYTES / CHUNK_BYTES;
  for (let index = 0; index < chunks; ++index) {
    const address = index * CHUNK_BYTES, length = probe ? 16 : CHUNK_BYTES;
    body += binary(address) + binary(length) + xlib(256, 36); // PEEKARM
    source.push(`  #${hex(address, 8)}h #${hex(length, 8)}h PEEKARM`);
    if (!probe || storeProbe) {
      const path = `ORCHARD/${storeProbe ? 'OR49T000' : captureName(pass, index)}`;
      body += sdPath(path) + xlib(2, 341); // STO to SD (port 3), never port 2
      source[source.length - 1] += ` :3:"${path}" STO`;
    }
  }
  if (!probe) {
    body += string(`OR49 ${pass} complete: 128 chunks`);
    source.push(`  "OR49 ${pass} complete: 128 chunks"`);
  }
  body += integer(0x0312b, 5);
  source.push('»', '');
  return { bytes: packed(body), source: source.join('\n') };
}

// Accept exactly one binary HP49 string. Do not silently strip Kermit, ZIP,
// backup-object wrappers, whitespace, checksums, truncation or trailing data.
export function decodeCaptureString(bytes, expectedBytes = CHUNK_BYTES) {
  if (![16, CHUNK_BYTES].includes(expectedBytes)) throw new Error('Invalid capture size');
  if (!(bytes instanceof Uint8Array) || bytes.length < 13 || bytes.length > expectedBytes * 2 + 13)
    throw new Error('Expected one bounded HP49 binary string');
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!/^HPHP49-[A-Za-z]$/.test(data.subarray(0, 8).toString('latin1')))
    throw new Error('Expected an HPHP49 binary transfer header');
  const nibble = index => (data[8 + (index >> 1)] >> ((index & 1) * 4)) & 15;
  const word = (at, count) => {
    let value = 0;
    for (let i = count - 1; i >= 0; --i) value = value * 16 + nibble(at + i);
    return value;
  };
  if (word(0, 5) !== 0x02a2c) throw new Error('Capture must be a string object');
  const size = word(5, 5);
  if (size < 5 || (size - 5) % 2 || 8 + (5 + size) / 2 !== data.length)
    throw new Error('Capture string length or trailing data is invalid');
  const text = Buffer.alloc((size - 5) / 2);
  for (let i = 0; i < text.length; ++i) text[i] = word(10 + i * 2, 2);
  if (text.length !== expectedBytes * 2 || !/^[0-9A-Fa-f]+$/.test(text.toString('latin1')))
    throw new Error(`Capture must contain exactly ${expectedBytes * 2} hexadecimal characters`);
  const output = Buffer.alloc(expectedBytes);
  for (let i = 0; i < output.length; ++i) {
    // PEEKARM's hex string uses HP nibble order, as consumed by H→S.
    output[i] = parseInt(String.fromCharCode(text[i * 2 + 1], text[i * 2]), 16);
  }
  return output;
}

async function readChunk(path, expectedBytes = CHUNK_BYTES) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== expectedBytes * 2 + 13)
    throw new Error(`Not a complete regular capture file: ${basename(path)}`);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await file.stat();
    if (!current.isFile() || current.size !== info.size || current.dev !== info.dev || current.ino !== info.ino)
      throw new Error(`Capture changed before opening: ${basename(path)}`);
    const bytes = Buffer.alloc(info.size + 1);
    let used = 0;
    while (used < bytes.length) {
      const read = await file.read(bytes, used, bytes.length - used, used);
      if (!read.bytesRead) break;
      used += read.bytesRead;
    }
    if (used !== info.size) throw new Error(`Capture size changed while reading: ${basename(path)}`);
    return bytes.subarray(0, used);
  } finally { await file.close(); }
}

export function inspectProbeCapture(bytes) {
  const image = decodeCaptureString(bytes, 16), inspected = inspectInput(image);
  if (!inspected.plausible_arm_vector)
    throw new Error('Probe does not produce a plausible ARM reset vector in low-nibble-first order; stop before full capture');
  return { schema: 'orchard-hp49gplus-read-probe-v1', bytes: image.length,
    sha256: hash(image), first_word: inspected.first_word,
    nibble_order: 'low-first', transfer_header: Buffer.from(bytes).subarray(0, 8).toString('latin1'),
    address_space: 'stock-OS ARM virtual address space', physical_mapping_verified: false,
    complete_flash: false, hardware_provenance_verified: false };
}

export async function assembleCaptures(directory) {
  const entries = await readdir(directory), byName = new Map();
  for (const entry of entries) {
    const key = entry.toUpperCase();
    if (/^OR49[AB]/.test(key)) {
      if (!/^OR49[AB]\d{3}$/.test(key) || byName.has(key))
        throw new Error(`Unexpected or duplicate capture name: ${entry}`);
      byName.set(key, entry);
    }
  }
  const expected = FLASH_BYTES / CHUNK_BYTES;
  if (byName.size !== expected * 2) throw new Error(`Need all ${expected} chunks from each independent A/B read`);
  const image = Buffer.alloc(FLASH_BYTES), chunks = [];
  for (let index = 0; index < expected; ++index) {
    const files = ['A', 'B'].map(pass => byName.get(captureName(pass, index)));
    if (files.some(file => !file)) throw new Error(`Missing capture at index ${index}`);
    const captures = [];
    for (const file of files) captures.push(await readChunk(resolve(directory, file)));
    const decoded = captures.map(bytes => decodeCaptureString(bytes));
    if (!decoded[0].equals(decoded[1])) throw new Error(`Independent reads disagree at chunk ${index}`);
    image.set(decoded[0], index * CHUNK_BYTES);
    chunks.push({ index, offset: index * CHUNK_BYTES, bytes: CHUNK_BYTES,
      sha256: hash(decoded[0]), capture_sha256: captures.map(hash) });
  }
  const inspected = inspectInput(image);
  if (!inspected.plausible_arm_vector) throw new Error('Readback does not start with a plausible ARM reset vector');
  assertModelIdentity(5, inspected);
  const bootHash = hash(image.subarray(0, 0x4000));
  const os = image.subarray(0x4000);
  if (os.every(b => b === 0xff) || os.every(b => b === 0))
    throw new Error('Only a boot region is present; remainder is erased or zero');
  return { image, report: {
    schema: 'orchard-hp49gplus-flash-capture-v1', model: 'hp49gplus', bytes: image.length,
    sha256: inspected.sha256, first_word: inspected.first_word, boot_region_bytes: 0x4000,
    boot_region_sha256: bootHash, native_boot_region: inspected.native_boot_region, independent_reads_equal: true,
    capture_encoding: 'HPHP49-string/PEEKARM-low-nibble-first', chunk_bytes: CHUNK_BYTES,
    source: 'user-declared hardware capture; A/B byte agreement verified locally',
    address_space: 'stock-OS ARM virtual address space', full_address_range_covered: true,
    physical_mapping_verified: false, authenticated_hardware_provenance: false,
    boot_verified: false, catalog_admitted: false, chunks,
  } };
}

export async function createCapturePackage(directory) {
  await mkdir(directory); // fail rather than overwrite an earlier package
  await mkdir(resolve(directory, 'ORCHARD'));
  const files = {};
  for (const [name, pass, probe, storeProbe] of [
    ['OR49P', 'A', true, false], ['OR49T', 'A', true, true],
    ['OR49A', 'A', false, false], ['OR49B', 'B', false, false],
  ]) {
    const built = buildReadProgram(pass, { probe, storeProbe });
    for (const [extension, content] of [['hp', built.bytes], ['rpl', built.source]]) {
      const file = `${name}.${extension}`;
      await writeFile(resolve(directory, file), content, { flag: 'wx' });
      files[file] = { bytes: Buffer.byteLength(content), sha256: hash(content) };
    }
  }
  await mkdir(resolve(directory, 'tools'));
  for (const [file, source] of [
    ['README-zh.md', '../docs/development/flash-capture.md'],
    ['LICENSE', '../LICENSE'], ['tools/flash-capture.mjs', './flash-capture.mjs'],
    ['tools/rom-inputs.mjs', './rom-inputs.mjs'],
  ]) {
    const content = await readFile(new URL(source, import.meta.url));
    await writeFile(resolve(directory, file), content, { flag: 'wx' });
    files[file] = { bytes: content.length, sha256: hash(content) };
  }
  const manifest = { schema: 'orchard-hp49gplus-read-package-v1', model: 'hp49gplus',
    firmware_requirement: 'HP stock ROM 2.00 or newer with documented PEEKARM',
    flash_bytes: FLASH_BYTES, chunk_bytes: CHUNK_BYTES, chunks_per_pass: FLASH_BYTES / CHUNK_BYTES,
    firmware_included: false, native_machine_code_included: false, flash_write_commands: false,
    address_space: 'stock-OS ARM virtual address space', physical_mapping_verified: false,
    hardware_validated: false, files };
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(resolve(directory, 'manifest.json'), manifestText, { flag: 'wx' });
  const checksums = Object.entries({ ...files, 'manifest.json': { sha256: hash(manifestText) } })
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([file, info]) => `${info.sha256}  ${file}`).join('\n') + '\n';
  await writeFile(resolve(directory, 'SHA256SUMS'), checksums, { flag: 'wx' });
  return manifest;
}

async function main(args) {
  if (args.length === 2 && args[0] === 'package') {
    console.log(JSON.stringify(await createCapturePackage(resolve(args[1])), null, 2));
    return;
  }
  if (args.length === 3 && args[0] === 'assemble') {
    const { image, report } = await assembleCaptures(resolve(args[1]));
    const output = resolve(args[2]);
    // Reserve both outputs before writing either; never replace a dump/report.
    const { unlink } = await import('node:fs/promises');
    const raw = await open(output, 'wx');
    let metadata;
    try { metadata = await open(`${output}.json`, 'wx'); }
    catch (error) { await raw.close(); await unlink(output); throw error; }
    try {
      await raw.writeFile(image);
      await metadata.writeFile(JSON.stringify(report, null, 2) + '\n');
    } finally { await raw.close(); await metadata.close(); }
    console.log(JSON.stringify({ bytes: report.bytes, sha256: report.sha256,
      independent_reads_equal: true, physical_mapping_verified: false,
      boot_verified: false, catalog_admitted: false }, null, 2));
    return;
  }
  if (args.length === 2 && args[0] === 'probe') {
    console.log(JSON.stringify(inspectProbeCapture(await readChunk(resolve(args[1]), 16)), null, 2));
    return;
  }
  throw new Error('Usage: node tools/flash-capture.mjs package NEW-DIRECTORY\n       node tools/flash-capture.mjs probe OR49T000\n       node tools/flash-capture.mjs assemble CAPTURE-DIRECTORY NEW-DUMP.bin');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
