// SPDX-License-Identifier: MIT
// Fixed, local-only original-ROM witness. Not a canonical hardware certificate.
import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFirmware, sha256 } from './rom-inputs.mjs';

const usage = 'Usage: node tools/probe-hp48-startup.mjs FULL-48GII-NOR.bin NEW-REPORT.json';
if (process.argv.length === 3 && process.argv[2] === '--help') {
  console.log(`${usage}\nRuns two native and two production-WASM cold boots, 300 million virtual ticks each.\nNo ROM is downloaded, modified or published. This can take several minutes.`);
  process.exit(0);
}
if (process.argv.length !== 4) throw new Error(usage);
const rom = resolve(process.argv[2]), output = resolve(process.argv[3]);
const root = fileURLToPath(new URL('../', import.meta.url));
const inputHash = '4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937';
assert.equal(sha256(await readFirmware(rom)), inputHash, 'This witness requires the pinned complete HP48gII USB-revision dump');
try {
  await access(output);
  throw new Error('Output must be a new path');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
// Raw physical switches: F6, F6, 1 + 2 ENTER, 7 * 8 ENTER. No guest-state edits.
const events = [
  [60000000, 5, 5, 1], [65000000, 5, 5, 0],
  [120000000, 5, 5, 1], [125000000, 5, 5, 0],
  [180000000, 3, 5, 1], [182000000, 3, 5, 0],
  [190000000, 0, 5, 1], [192000000, 0, 5, 0],
  [200000000, 2, 5, 1], [202000000, 2, 5, 0],
  [210000000, 0, 6, 1], [212000000, 0, 6, 0],
  [240000000, 3, 3, 1], [242000000, 3, 3, 0],
  [250000000, 0, 3, 1], [252000000, 0, 3, 0],
  [260000000, 2, 3, 1], [262000000, 2, 3, 0],
  [270000000, 0, 6, 1], [272000000, 0, 6, 0],
];
const child = spawnSync(process.execPath, ['tools/probe-rom.mjs', '--model', 'hp48gii',
  '--rom', rom, '--ticks', '300000000', '--keyboard', 'apples',
  '--nor-device', 'sst39vf1601', '--sram-decode', 'bank1-mirror',
  '--gpio-input', 'D:cc7f:0,F:8e:0,G:1:0', '--gpio-bias', 'G:f800:f800',
  '--adc-input', '0:1023,7:512', '--lcd-probe68', 'idle-zero',
  '--frame-view', 'packed-lsb', '--key-at', events.map(e => e.join(':')).join(',')],
{ cwd: root, encoding: 'utf8', timeout: 900000, maxBuffer: 2 * 1024 * 1024 });
if (child.error) throw child.error;
assert.equal(child.status, 0, child.stderr || 'Cold-boot probe failed');
const report = JSON.parse(child.stdout);
assert.equal(report.input_sha256, inputHash, 'Input changed between reads');
assert.equal(report.result.stop.code, 0);
assert.equal(report.result.ticks, '300000000');
assert.equal(report.result.fault_status, '00000000');
assert.equal(report.result.fault_address, '00000000');
assert.equal(report.result.key_events_applied, events.length);
assert.equal(report.sram_alias_reads, '1');
assert.equal(report.sram_alias_writes, '0');
assert.equal(report.lcd_unverified_reads, '24');
assert.equal(report.frame_sha256, '53a2eda0fe1c185236eda700cfaa6328fbb14bd89c8ffbe0b5ffde097bf527e9');
assert(report.native_wasm_equal && report.native_replay_equal && report.wasm_replay_equal);
report.startup_witness = {
  kind: 'conditional-stock-home-and-two-calculations',
  displayed_history: ['1+2', '3', '7*8', '56'],
  verification: 'Exact framebuffer hash of a visually inspected original-OS result; no OCR or synthetic pixels',
  canonical_hardware_boot: false,
  conditions: ['bank1-mirror is unmeasured board address wiring', 'idle-zero LCD +0x68 is counted and unverified',
    'packed-lsb is a memory inspection view, not verified physical panel mapping', 'GPIO bias and ADC codes are explicit test inputs'],
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(`Conditional HP48gII HOME: 1+2=3, then 7*8=56. Native/WASM and both cold replays agree.\nReport: ${output}\nCanonical hardware boot remains unverified.`);
