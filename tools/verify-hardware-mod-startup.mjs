// SPDX-License-Identifier: MIT
// Fixed native/WASM cold replay of user-supplied hardware-modification ROMs.
// The expected LCDs were independently viewed; a completed budget is not a pass.
import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hardwareModSetup } from '../web/hardware-mod.js';
import { models, readFirmware, sha256 } from './rom-inputs.mjs';

const usage = 'Usage: node tools/verify-hardware-mod-startup.mjs PRESET FULL-NOR NEW-REPORT.json';
if (process.argv[2] === '--help') { console.log(usage); process.exit(0); }
assert.equal(process.argv.length, 5, usage);
const variant = hardwareModSetup(process.argv[2]); assert(variant, 'Unknown hardware-modification preset');
const root = fileURLToPath(new URL('../', import.meta.url));
const rom = resolve(process.argv[3]), output = resolve(process.argv[4]);
assert.equal(sha256(await readFirmware(rom)), variant.hash, 'The witness requires the exact documented full-NOR variant');
await assert.rejects(access(output), { code:'ENOENT' }, 'Output must be a new path');
const thirtyNine = [[50000000,40],[124000000,26],[128000000,5],[132000000,26],[136000000,6]];
const scenarios = {
  'hp39gs-archive-home': { ticks:198000000, taps:thirtyNine,
    frame:'15c75f8dac2d8f7305338d281651523c95e11f80f564ba6cdb22031756f50759', result:'HOME: 1+1 = 2' },
  'hp39gs-font-home': { ticks:198000000, taps:thirtyNine,
    frame:'15c75f8dac2d8f7305338d281651523c95e11f80f564ba6cdb22031756f50759', result:'HOME: 1+1 = 2' },
  'hp40gs-mod-home': { ticks:310000000,
    taps:[...thirtyNine,[190000000,40],[220000000,26],[224000000,2],[228000000,12],
      [232000000,45],[236000000,5],[240000000,26],[244000000,2],[248000000,11],[252000000,6]],
    frame:'00bf6ab563c0f525c573321bdd2f951674133cec1ea74a5444d3811b4d5bd4f9',
    result:'HOME: 1+1 = 2; enter CAS and evaluate 1/3 + 1/6 = 1/2' },
  'hp50gm-home': { ticks:300000000,
    taps:[[60000000,40],[120000000,40],[180000000,26],[190000000,5],[200000000,19],
      [210000000,6],[240000000,24],[250000000,3],[260000000,17],[270000000,6]],
    frame:'53a2eda0fe1c185236eda700cfaa6328fbb14bd89c8ffbe0b5ffde097bf527e9',
    result:'64-line HOME: 1+2 = 3; 7*8 = 56, with 512 KiB SRAM' },
};
const scenario = scenarios[variant.preset];
const events = scenario.taps.flatMap(([tick,scan]) => [[tick,Math.floor(scan/7),scan%7,1],
  [tick+2000000,Math.floor(scan/7),scan%7,0]]);
const child = spawnSync(process.execPath, ['tools/probe-rom.mjs', '--model', models[variant.model-1],
  '--rom', rom, '--ticks', String(scenario.ticks), '--keyboard', 'apples',
  '--nor-device', variant.nor === 1 ? 'sst39vf1601' : 'sst39vf800a', '--sram-decode', 'bank1-mirror',
  '--gpio-input', variant.model === 7 ? 'D:cc7f:0,E:c000:c000,F:8e:0,G:1:0' : 'D:cc7f:0,F:8e:0,G:1:0',
  '--gpio-bias', 'G:f800:f800', '--adc-input', '0:1023,7:512', '--lcd-probe68', 'idle-zero',
  '--frame-view', 'packed-lsb', '--key-at', events.map(e => e.join(':')).join(',')],
{ cwd:root, encoding:'utf8', timeout:1200000, maxBuffer:2*1024*1024 });
assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
const report = JSON.parse(child.stdout);
assert.equal(report.input_sha256, variant.hash);
assert.equal(report.input_kind, 'hardware-mod-nor');
assert.equal(report.result.stop.code, 0);
assert.equal(report.result.ticks, String(scenario.ticks));
assert.equal(report.result.fault_status, '00000000');
assert.equal(report.result.fault_address, '00000000');
assert.equal(report.result.key_events_applied, events.length);
assert.equal(report.frame_sha256, scenario.frame, 'Original calculator result differs from the visually verified LCD');
assert(report.native_wasm_equal && report.native_replay_equal && report.wasm_replay_equal);
report.functional_witness = { preset:variant.preset, label:variant.label, visible_result:scenario.result,
  original_input_unchanged:true, physical_key_input:true, frames_independently_viewed:true,
  canonical_hardware_boot:false, stock_model_verified:false,
  conditions:['Explicit bank1 mirror, GPIO inputs/bias, ADC codes and LCD +0x68 idle-zero',
    'Packed-LSB display interpretation; donor-board wiring remains unmeasured'] };
await writeFile(output, JSON.stringify(report, null, 2)+'\n', { flag:'wx' });
console.log(`${variant.label}: ${scenario.result}. Native/WASM and both cold replays agree.\n${output}`);
