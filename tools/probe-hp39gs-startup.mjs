// SPDX-License-Identifier: MIT
// Fixed, local-only original-ROM witness. Not a canonical hardware certificate.
import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFirmware, sha256 } from './rom-inputs.mjs';

const usage = 'Usage: node tools/probe-hp39gs-startup.mjs FULL-39GS-NOR.bin NEW-REPORT.json';
if (process.argv.length === 3 && process.argv[2] === '--help') {
  console.log(`${usage}\nRuns two native and two production-WASM cold boots, 198 million virtual ticks each.\nNo ROM is downloaded, modified or published. This can take several minutes.`);
  process.exit(0);
}
if (process.argv.length !== 4) throw new Error(usage);
const rom = resolve(process.argv[2]), output = resolve(process.argv[3]);
const root = fileURLToPath(new URL('../', import.meta.url));
const inputHash = 'a431b5d61af36aeaffec02a395da648b01507c3b5acc9d325f113384483680ff';
assert.equal(sha256(await readFirmware(rom)), inputHash, 'This witness requires the pinned complete HP39gs 2.22 dump');
try {
  await access(output);
  throw new Error('Output must be a new path');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
// Raw switches: confirm Memory Clear, enter 1+1, visit APLET, return HOME.
// Timings are frozen from the independently inspected original-ROM run.
const taps = [[50000000,40],[124000000,26],[128000000,5],[132000000,26],
  [136000000,6],[160000000,49],[184000000,48]];
const events = taps.flatMap(([tick,scan]) => [[tick,Math.floor(scan/7),scan%7,1],
  [tick+2000000,Math.floor(scan/7),scan%7,0]]);
const child = spawnSync(process.execPath, ['tools/probe-rom.mjs', '--model', 'hp39gs',
  '--rom', rom, '--ticks', '198000000', '--keyboard', 'apples',
  '--nor-device', 'sst39vf800a',
  '--gpio-input', 'D:cc7f:0,F:8e:0,G:1:0', '--gpio-bias', 'G:f800:f800',
  '--adc-input', '0:1023,7:512', '--lcd-probe68', 'idle-zero',
  '--frame-view', 'packed-lsb', '--key-at', events.map(e => e.join(':')).join(',')],
{ cwd: root, encoding: 'utf8', timeout: 900000, maxBuffer: 2 * 1024 * 1024 });
if (child.error) throw child.error;
assert.equal(child.status, 0, child.stderr || 'Cold-boot probe failed');
const report = JSON.parse(child.stdout);
assert.equal(report.input_sha256, inputHash, 'Input changed between reads');
assert.equal(report.result.stop.code, 0);
assert.equal(report.result.ticks, '198000000');
assert.equal(report.result.fault_status, '00000000');
assert.equal(report.result.fault_address, '00000000');
assert.equal(report.result.key_events_applied, events.length);
assert.equal(report.sram_alias_reads, '0');
assert.equal(report.sram_alias_writes, '0');
assert.equal(report.lcd_unverified_reads, '12');
assert.equal(report.frame_sha256, '15c75f8dac2d8f7305338d281651523c95e11f80f564ba6cdb22031756f50759');
assert(report.native_wasm_equal && report.native_replay_equal && report.wasm_replay_equal);
report.startup_witness = {
  kind: 'conditional-stock-home-arithmetic-and-aplet-return',
  displayed_history: ['1+1', '2'],
  verification: 'Exact framebuffer hash of a visually inspected original-OS result; no OCR or synthetic pixels',
  canonical_hardware_boot: false,
  conditions: ['SST39VF800A part identity on HP39gs remains an explicit hypothesis; SRAM decode is exact', 'idle-zero LCD +0x68 is counted and unverified',
    'packed-lsb is a memory inspection view, not verified physical panel mapping', 'GPIO bias and ADC codes are explicit test inputs'],
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(`Conditional HP39gs HOME: 1+1=2, APLET and HOME return. Native/WASM and both cold replays agree.\nReport: ${output}\nCanonical hardware boot remains unverified.`);
