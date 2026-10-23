// SPDX-License-Identifier: MIT
// Private original-ROM continuation witness. Never publishes ROM or saved RAM.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { applySetup, HP39GS_ROM } from '../web/hp48.js';

const usage = 'Usage: node tools/probe-hp39gs-checkpoint.mjs FULL-39GS-NOR.bin NEW-REPORT.json';
if (process.argv.length === 3 && process.argv[2] === '--help') {
  console.log(`${usage}\nCold boots the original HP39gs, saves after 1+1, then compares APLET/HOME continuation and native/WASM resume.`);
  process.exit(0);
}
if (process.argv.length !== 4) throw new Error(usage);
const [romPath, output] = process.argv.slice(2).map(p => resolve(p));
const rom = await readFile(romPath), wasm = await readFile('dist/orchard.wasm');
const sha = b => createHash('sha256').update(b).digest('hex');
assert.equal(sha(rom), HP39GS_ROM);
const native = resolve(process.env.ORCHARD_BUILD_DIR || 'build', process.platform === 'win32' ? 'orchard-checkpoint-replay.exe' : 'orchard-checkpoint-replay');
const taps = [[50000000,40],[124000000,26],[128000000,5],[132000000,26],
  [136000000,6],[160000000,49],[184000000,48]];
const keys = taps.flatMap(([tick,scan]) => [{tick,scan,down:1},{tick:tick+2000000,scan,down:0}]);
function tick(c) { const s = new Uint32Array(c.memory.buffer,c.snapshot(),33); return s[22]+s[23]*4294967296; }
function run(c,end,events) {
  let at=tick(c), i=events.findIndex(e=>e.tick>=at); if(i<0)i=events.length;
  while(at<end) {
    while(i<events.length && events[i].tick===at) { const e=events[i++]; assert.equal(c.keyboard_matrix(Math.floor(e.scan/7),e.scan%7,e.down),0); }
    const count=Math.min(256,end-at,(events[i]?.tick??end)-at); assert(count>0);
    assert.equal(c.run(count),0); at+=count; c.uart_receive();
  }
}
function save(c) { assert.equal(c.checkpoint_save(),0); return new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice(); }
function load(c,bytes) { const p=c.checkpoint_buffer(bytes.length); assert(p); new Uint8Array(c.memory.buffer,p,bytes.length).set(bytes); assert.equal(c.checkpoint_load(bytes.length),0); }
async function create() {
  const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{}); assert.equal(c.create(2),0);
  new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom); assert.equal(c.load(rom.length),0); return c;
}
const temp=await mkdtemp(resolve(tmpdir(),'orchard-hp39gs-resume-'));
try {
  const a=await create(); applySetup(a,2,'hp39gs-home'); run(a,160000000,keys);
  const saved=save(a); run(a,198000000,keys); const uninterrupted=save(a);
  const b=await create(); load(b,saved); assert.deepEqual(save(b),saved);
  run(b,198000000,keys); assert.deepEqual(save(b),uninterrupted,'APLET/HOME continuation changed after restore');
  assert.equal(b.frame_view(1),0); const frame=sha(new Uint8Array(b.memory.buffer,b.frame_buffer(),131*64));
  assert.equal(frame,'15c75f8dac2d8f7305338d281651523c95e11f80f564ba6cdb22031756f50759');
  const before=resolve(temp,'before.checkpoint'), after=resolve(temp,'native-after.checkpoint');
  await writeFile(before,uninterrupted,{flag:'wx'});
  const result=spawnSync(native,['2',romPath,before,'50000',after],{encoding:'utf8',timeout:60000,maxBuffer:1048576});
  if(result.error)throw result.error; assert.equal(result.status,0,result.stderr);
  run(b,198050000,[]); assert.deepEqual(save(b),new Uint8Array(await readFile(after)),'Native/WASM resume differs');
  await writeFile(output,JSON.stringify({schema:'orchard-hp39gs-continuation-v1',model:2,
    rom_sha256:sha(rom),wasm_sha256:sha(wasm),saved_at:160000000,checkpoint_bytes:saved.length,
    checkpoint_version:new DataView(saved.buffer).getUint32(8,true),saved_sha256:sha(saved),
    final_frame_sha256:frame,uninterrupted_and_restored_equal:true,native_wasm_resume_equal:true,
    native_wasm_resume_ticks:50000,guest_memory_patched:false,canonical_hardware_boot:false,
    scope:'Original-ROM 1+1, saved state, physical APLET/HOME switches, exact serialized continuation and portable resume. Browser file-picker workflow is a separate witness.'},null,2)+'\n',{flag:'wx'});
  console.log('HP39gs checkpoint: original-ROM APLET/HOME continuation and native/WASM resume are byte-identical.');
} finally { await rm(temp,{recursive:true,force:true}); }
