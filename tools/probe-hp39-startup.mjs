// SPDX-License-Identifier: MIT
// Fixed, local-only original-ROM witness. Not a canonical hardware certificate.
import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFirmware, sha256 } from './rom-inputs.mjs';

const usage = 'Usage: node tools/probe-hp39-startup.mjs FULL-39GPLUS-NOR.bin NEW-REPORT.json';
if (process.argv.length === 3 && process.argv[2] === '--help') {
  console.log(`${usage}\nRuns two native and two production-WASM cold boots, 230 million virtual ticks each.\nNo ROM is downloaded, modified or published. This can take several minutes.`);
  process.exit(0);
}
if (process.argv.length !== 4) throw new Error(usage);
const rom = resolve(process.argv[2]), output = resolve(process.argv[3]);
const root = fileURLToPath(new URL('../', import.meta.url));
const inputHash = '95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67';
assert.equal(sha256(await readFirmware(rom)), inputHash, 'This witness requires the pinned complete HP39g+ D1.55 dump');
try {
  await access(output);
  throw new Error('Output must be a new path');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
// Raw physical switches: F6, 1 + 2 ENTER, 7 * 8 ENTER. No guest-state edits.
const events = [[50000000,5,5,1],[53000000,5,5,0],[120000000,3,5,1],[122000000,3,5,0],[130000000,0,5,1],[132000000,0,5,0],[140000000,2,5,1],[142000000,2,5,0],[150000000,0,6,1],[152000000,0,6,0],[180000000,3,3,1],[182000000,3,3,0],[190000000,0,3,1],[192000000,0,3,0],[200000000,2,3,1],[202000000,2,3,0],[210000000,0,6,1],[212000000,0,6,0]];
const child = spawnSync(process.execPath, ['tools/probe-rom.mjs', '--model', 'hp39gplus',
  '--rom', rom, '--ticks', '230000000', '--keyboard', 'apples',
  '--nor-device', 'sst39vf800a',
  '--gpio-input', 'F:8e:0',
  '--adc-input', '0:1023', '--lcd-probe68', 'idle-zero',
  '--frame-view', 'packed-lsb', '--key-at', events.map(e => e.join(':')).join(',')],
{ cwd: root, encoding: 'utf8', timeout: 900000, maxBuffer: 2 * 1024 * 1024 });
if (child.error) throw child.error;
assert.equal(child.status, 0, child.stderr || 'Cold-boot probe failed');
const report = JSON.parse(child.stdout);
assert.equal(report.input_sha256, inputHash, 'Input changed between reads');
assert.equal(report.result.stop.code, 0);
assert.equal(report.result.ticks, '230000000');
assert.equal(report.result.fault_status, '00000000');
assert.equal(report.result.fault_address, '00000000');
assert.equal(report.result.key_events_applied, events.length);
assert.equal(report.sram_alias_reads, '0');
assert.equal(report.sram_alias_writes, '0');
assert.equal(report.lcd_unverified_reads, '22');
assert.equal(report.frame_sha256, 'efec8205f401a7189f3cd77eeaac6947165d480b383033c9796c86e95e9f6968');
assert(report.native_wasm_equal && report.native_replay_equal && report.wasm_replay_equal);
report.startup_witness = {
  kind: 'conditional-stock-home-and-two-calculations',
  displayed_history: ['1+2', '3', '7*8', '56'],
  verification: 'Exact framebuffer hash of a visually inspected original-OS result; no OCR or synthetic pixels',
  canonical_hardware_boot: false,
  conditions: ['SST39VF800A part identity on HP39g+ remains an explicit hypothesis; SRAM decode is exact', 'idle-zero LCD +0x68 is counted and unverified',
    'packed-lsb is a memory inspection view, not verified physical panel mapping', 'GPIO bias and ADC codes are explicit test inputs'],
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(`Conditional HP39g+ HOME: 1+2=3, then 7*8=56. Native/WASM and both cold replays agree.\nReport: ${output}\nCanonical hardware boot remains unverified.`);
