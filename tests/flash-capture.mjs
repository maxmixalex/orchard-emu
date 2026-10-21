// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { FLASH_BYTES, CHUNK_BYTES, buildReadProgram, captureName, decodeCaptureString,
  assembleCaptures, inspectProbeCapture, createCapturePackage } from '../tools/flash-capture.mjs';

let checks = 0;
const check = fn => { fn(); ++checks; };
const digest = data => createHash('sha256').update(data).digest('hex');

// Independent packed-object reader: consume numeric nibble fields, not the
// generator's reversed-hex-string helpers. Unknown executable types are errors.
function objects(data) {
  assert.equal(data.subarray(0, 8).toString('latin1'), 'HPHP49-C');
  const buffer = data.subarray(8);
  let bit = 0;
  function number(count) {
    assert.ok(bit + count * 4 <= buffer.length * 8);
    let value = 0n;
    for (let n = 0; n < count * 4; ++n, ++bit)
      if (buffer[bit >> 3] & (1 << (bit & 7))) value |= 1n << BigInt(n);
    return Number(value);
  }
  const text = count => Array.from({ length: count }, () => String.fromCharCode(number(2))).join('');
  function object() {
    const prolog = number(5);
    if (prolog === 0x0312b) return { type: 'end' };
    if (prolog === 0x02d9d) {
      const body = [];
      for (;;) {
        const next = object();
        if (next.type === 'end') break;
        body.push(next);
      }
      return { type: 'program', body };
    }
    if (prolog === 0x02a4e) {
      assert.equal(number(5), 21);
      return { type: 'binary', value: number(16) };
    }
    if (prolog === 0x02a2c) {
      const size = number(5);
      assert.equal((size - 5) % 2, 0);
      return { type: 'string', value: text((size - 5) / 2) };
    }
    if (prolog === 0x02afc) return { type: 'tag', tag: text(number(2)), object: object() };
    if (prolog === 0x02e92) return { type: 'command', library: number(3), command: number(3) };
    assert.fail(`Unexpected object prolog ${prolog.toString(16)}`);
  }
  const result = object();
  assert.ok(buffer.length * 8 - bit < 8);
  if (bit < buffer.length * 8) assert.equal(number(1), 0);
  return result;
}

// An executable audit, independent of generated textual source: check every
// command, range, destination and literal before releasing a hardware package.
const peek = { type: 'command', library: 256, command: 36 };
const store = { type: 'command', library: 2, command: 341 };
for (const pass of ['A', 'B']) {
  const built = buildReadProgram(pass), decoded = objects(built.bytes);
  check(() => assert.equal(decoded.type, 'program'));
  check(() => assert.equal(decoded.body.length, 128 * 5 + 1));
  for (let index = 0; index < 128; ++index) {
    const read = decoded.body.slice(index * 5, index * 5 + 5);
    check(() => assert.deepEqual(read, [
      { type: 'binary', value: index * 0x4000 }, { type: 'binary', value: 0x4000 }, peek,
      { type: 'tag', tag: '3', object: { type: 'string', value: `ORCHARD/OR49${pass}${String(index).padStart(3, '0')}` } }, store,
    ]));
  }
  check(() => assert.deepEqual(decoded.body.at(-1), { type: 'string', value: `OR49 ${pass} complete: 128 chunks` }));
}
const probe = buildReadProgram('A', { probe: true });
check(() => assert.deepEqual(objects(probe.bytes).body, [
  { type: 'binary', value: 0 }, { type: 'binary', value: 16 }, peek,
]));
check(() => assert.equal(probe.bytes.length, 45));
const sdProbe = buildReadProgram('A', { probe: true, storeProbe: true });
check(() => assert.deepEqual(objects(sdProbe.bytes).body, [
  { type: 'binary', value: 0 }, { type: 'binary', value: 16 }, peek,
  { type: 'tag', tag: '3', object: { type: 'string', value: 'ORCHARD/OR49T000' } }, store,
]));
for (const bad of [['C', 0], ['A', -1], ['B', 128], ['A', 1.1]])
  check(() => assert.throws(() => captureName(...bad)));
check(() => assert.throws(() => buildReadProgram('C')));
check(() => assert.throws(() => buildReadProgram('A', { storeProbe: true })));

// File fixture is built as a 40-bit little-endian header + literal ASCII,
// independently of the program object writer and production string decoder.
function capture(raw, highFirst = false) {
  const text = [...raw].map(value => {
    const pair = value.toString(16).padStart(2, '0');
    return highFirst ? pair : pair[1] + pair[0];
  }).join('');
  const result = Buffer.alloc(13 + text.length);
  result.write('HPHP49-C');
  result.writeUIntLE((text.length * 2 + 5) * 0x100000 + 0x02a2c, 8, 5);
  result.write(text, 13, 'ascii');
  return result;
}
const short = Buffer.alloc(16);
short.writeUInt32LE(0xea000006); short[4] = 0x51; short[5] = 0xab;
const shortFile = capture(short);
check(() => assert.equal(shortFile.subarray(13, 25).toString('ascii'), '600000ae15ba'));
check(() => assert.deepEqual(decodeCaptureString(shortFile, 16), short));
check(() => assert.equal(inspectProbeCapture(shortFile).first_word, 'ea000006'));
check(() => assert.equal(inspectProbeCapture(shortFile).complete_flash, false));
check(() => assert.throws(() => inspectProbeCapture(capture(short, true)), /reset vector/));
for (const mutate of [
  bytes => bytes.subarray(1), bytes => Buffer.concat([bytes, Buffer.from([0])]),
  bytes => { bytes[0] |= 128; return bytes; },
  bytes => { bytes[13] = 0xb6; return bytes; },
  bytes => { bytes[13] = 0x67; return bytes; },
  bytes => { bytes[8] ^= 1; return bytes; },
  bytes => { bytes[12] ^= 0x10; return bytes; },
]) check(() => assert.throws(() => decodeCaptureString(mutate(Buffer.from(shortFile)), 16)));
check(() => assert.throws(() => decodeCaptureString(shortFile)));
check(() => assert.throws(() => decodeCaptureString(shortFile, 15)));

const temp = await mkdtemp(resolve(tmpdir(), 'orchard-flash-capture-'));
try {
  const captures = resolve(temp, 'captures'); await mkdir(captures);
  const expected = Buffer.alloc(FLASH_BYTES);
  for (let index = 0; index < expected.length; ++index) expected[index] = index ^ (index >>> 4) ^ (index >>> 12);
  expected.writeUInt32LE(0xea000006);
  for (let index = 0; index < 128; ++index) {
    const chunk = capture(expected.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES));
    for (const pass of ['A', 'B']) await writeFile(resolve(captures, captureName(pass, index)), chunk);
  }
  await writeFile(resolve(captures, 'OR49T000'), shortFile);
  const result = await assembleCaptures(captures);
  check(() => assert.deepEqual(result.image, expected));
  check(() => assert.equal(result.report.sha256, digest(expected)));
  check(() => assert.equal(result.report.chunks.length, 128));
  check(() => assert.equal(result.report.independent_reads_equal, true));
  check(() => assert.equal(result.report.authenticated_hardware_provenance, false));
  check(() => assert.equal(result.report.physical_mapping_verified, false));
  check(() => assert.equal(result.report.boot_verified, false));
  check(() => assert.equal(result.report.catalog_admitted, false));
  check(() => assert.equal(result.report.chunks[127].offset + CHUNK_BYTES, FLASH_BYTES));
  const target = resolve(captures, 'OR49A000'), saved = await readFile(target);
  const lowercase = resolve(captures, 'or49a000');
  await rename(target, lowercase);
  assert.deepEqual((await assembleCaptures(captures)).image, expected); ++checks;
  await writeFile(target, saved);
  await assert.rejects(assembleCaptures(captures), /duplicate/); ++checks;
  await rm(lowercase);
  await rename(target, resolve(captures, 'missing'));
  await assert.rejects(assembleCaptures(captures), /Need all/); ++checks;
  await symlink(resolve(captures, 'missing'), target);
  await assert.rejects(assembleCaptures(captures), /regular capture/); ++checks;
  await rm(target); await rename(resolve(captures, 'missing'), target);
  const changed = Buffer.from(saved); changed[14] = changed[14] === 0x30 ? 0x31 : 0x30;
  await writeFile(target, changed);
  await assert.rejects(assembleCaptures(captures), /reads disagree/); ++checks;
  await writeFile(target, saved);
  const packageDir = resolve(temp, 'package');
  const manifest = await createCapturePackage(packageDir);
  for (const [file, metadata] of Object.entries(manifest.files)) {
    const content = await readFile(resolve(packageDir, file));
    check(() => assert.equal(content.length, metadata.bytes));
    check(() => assert.equal(digest(content), metadata.sha256));
  }
  check(() => assert.equal(manifest.firmware_included, false));
  check(() => assert.equal(manifest.hardware_validated, false));
  await assert.rejects(createCapturePackage(packageDir), /EEXIST/); ++checks;
  const output = resolve(temp, 'output.bin');
  const invoke = () => {
    const result = spawnSync(process.execPath,
      ['tools/flash-capture.mjs', 'assemble', captures, output], { encoding: 'utf8' });
    assert.equal(result.error, undefined, 'Node subprocess must run for CLI verification');
    return result;
  };
  await writeFile(`${output}.json`, 'existing report');
  check(() => assert.equal(invoke().status, 1));
  assert.equal((await readdir(temp)).includes('output.bin'), false); ++checks;
  await rm(`${output}.json`);
  check(() => assert.equal(invoke().status, 0));
  assert.deepEqual(await readFile(output), expected); ++checks;
  const repeated = invoke();
  check(() => assert.equal(repeated.status, 1));
  check(() => assert.equal(repeated.stdout, ''));
  const probePath = resolve(captures, 'OR49T000');
  const probeCLI = spawnSync(process.execPath, ['tools/flash-capture.mjs', 'probe', probePath], { encoding: 'utf8' });
  check(() => assert.equal(probeCLI.error, undefined, 'Node subprocess must run for probe verification'));
  check(() => assert.equal(probeCLI.status, 0));
  check(() => assert.equal(JSON.parse(probeCLI.stdout).bytes, 16));
} finally { await rm(temp, { recursive: true, force: true }); }
console.log(`Flash capture checks: ${checks} passed (synthetic data; no firmware or hardware)`);
