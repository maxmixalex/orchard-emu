// SPDX-License-Identifier: MIT
// Private, original-ROM witness: cold boot, arithmetic, natural auto-off,
// checkpoint while powered off, ON/reset-vector wake and more arithmetic.
// The only guest inputs are physical keys. No ROM/RAM/PC patch is used.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {HP39_ROM,HP39GS_ROM,HP48_ROM,HP49_ROM,applySetup} from '../web/hp48.js';
import {readFirmware,sha256} from './rom-inputs.mjs';

const usage='Usage: node tools/verify-stock-idle.mjs ORIGINAL-FULL-NOR.bin NEW-PRIVATE-OUTPUT-DIRECTORY [--checkpoint OLD-CHECKPOINT] [--manual]';
if(process.argv.length===3&&process.argv[2]==='--help'){
  console.log(usage+'\nDetects an admitted HP39g+/39gs/48gII/49g+ ROM by SHA-256. Waits up to 400 virtual seconds for natural Power_OFF, then saves/restores and wakes with ON. --manual uses SHIFT/ON instead; --checkpoint imports a historical checkpoint first. ORCHARD_WASM selects another build. Reports contain hashes and register metadata; the output directory also contains private LCD captures and a private session, but no ROM copy.');
  process.exit(0);
}
const args=process.argv.slice(2);
if(args.length<2)throw Error(usage);
let importedPath=null,manual=false;
for(let i=2;i<args.length;i++){
  if(args[i]==='--checkpoint'&&!importedPath&&args[i+1])importedPath=resolve(args[++i]);
  else if(args[i]==='--manual'&&!manual)manual=true;
  else throw Error(usage);
}
const rom=await readFirmware(resolve(args[0])),romHash=sha256(rom),output=resolve(args[1]);
const admission=new Map([
  [HP39_ROM,{model:1,preset:'hp39-home',height:64,name:'HP 39g+'}],
  [HP39GS_ROM,{model:2,preset:'hp39gs-home',height:64,name:'HP 39gs'}],
  [HP48_ROM,{model:4,preset:'hp48-home',height:64,name:'HP 48gII (USB revision)'}],
  [HP49_ROM,{model:5,preset:'hp49-home',height:80,name:'HP 49g+'}],
]).get(romHash);
assert(admission,'Requires one of the admitted original complete NOR images');
const {model,preset,height,name}=admission;
const wasm=await readFile(process.env.ORCHARD_WASM||new URL('../dist/orchard.wasm',import.meta.url));
await mkdir(output); // Never overwrite a previous success or failure.
const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
assert.equal(c.create(model),0);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);
assert.equal(c.load(rom.length),0);applySetup(c,model,preset);
const rawState=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));
const clocks=()=>Array.from(new Uint32Array(c.memory.buffer,c.clock_snapshot(),6));
const tick=()=>{const s=rawState();return s[22]+s[23]*2**32;};
function state(){const s=rawState();return {tick:s[22]+s[23]*2**32,instructions:s[20]+s[21]*2**32,
  pc:s[15],cpsr:s[16],control:s[17],sleeping:!!s[26],stop:{status:s[28],pc:s[29],instruction:s[30],address:s[31],detail:s[32]},clock:clocks()};}
const report={schema:'orchard-stock-idle-v1',model,name,preset,rom_sha256:romHash,wasm_sha256:sha256(wasm),
  tool_sha256:sha256(await readFile(new URL(import.meta.url))),physical_input_only:true,
  power_off_trigger:manual?'physical SHIFT/ON':'natural firmware inactivity timeout',
  canonical_hardware_boot:false,timebase_hz:12000000,clock_scope:'functional reference ticks, not calibrated ARM instruction timing',
  keys:[],stages:[],passed:false};
function run(n){while(n){const slice=Math.min(n,1000000);assert.equal(c.run(slice),0,JSON.stringify(state()));n-=slice;}}
function key(scan,down){assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):c.keyboard_dedicated([0,4,5,6][scan-56],+down),0);report.keys.push({tick:tick(),scan,down});}
function tap(scan){key(scan,true);run(1500000);key(scan,false);run(1500000);}
async function frame(label){
  assert.equal(c.frame_view(1),0);
  const pixels=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*height).slice();
  await writeFile(resolve(output,label+'.pgm'),Buffer.concat([Buffer.from(`P5\n131 ${height}\n255\n`),Buffer.from(pixels.map(v=>255-v))]),{flag:'wx'});
  const result={label,...state(),frame_sha256:sha256(pixels),lit_pixels:pixels.reduce((n,v)=>n+(v!==0),0)};
  report.stages.push(result);console.log(JSON.stringify({stage:label,tick:result.tick,stop:result.stop.status,power_off:!!(result.clock[3]&8)}));return result;
}
function save(){assert.equal(c.checkpoint_save(),0);return new Uint8Array(c.memory.buffer,c.checkpoint_buffer(0),c.checkpoint_size()).slice();}
function restore(bytes){const p=c.checkpoint_buffer(bytes.length);assert(p);new Uint8Array(c.memory.buffer,p,bytes.length).set(bytes);assert.equal(c.checkpoint_load(bytes.length),0);}
try{
  if(importedPath){
    const old=await readFile(importedPath);restore(old);
    report.imported_checkpoint={sha256:sha256(old),bytes:old.length,version:old.readUInt32LE(8),state:state()};
    // The historical witness is allowed to have a dismissible stock dialog.
    tap(40);if(model<=2)tap(48);run(20000000);
  }else{
    run(60000000);tap(40);run(57000000);
    if(model>=4){tap(40);run(57000000);}
  }
  for(const scan of [26,5,26,6])tap(scan);run(20000000);
  const before=await frame('before-idle');
  if(manual){tap(59);tap(56);run(20000000);}
  const limit=tick()+(manual?0:4800000000);let progress=tick()+600000000;
  while(!(clocks()[3]&8)&&tick()<limit){
    run(Math.min(12000000,limit-tick()));
    if(tick()>=progress){console.log(JSON.stringify({stage:'waiting',virtual_seconds:tick()/12000000}));progress+=600000000;}
  }
  assert(clocks()[3]&8,manual?'The original ROM did not request Power_OFF after SHIFT/ON':'The original ROM did not request Power_OFF within 400 virtual seconds after the last operation');
  const off=await frame(manual?'manual-off':'auto-off');assert(off.sleeping);assert.equal(off.lit_pixels,0,'LCD must be blank while powered off');
  report.power_off={observed_at_tick:off.tick,poll_bound_ticks:manual?null:12000000,after_last_operation_seconds:(off.tick-before.tick)/12000000};
  const suspended=save();await writeFile(resolve(output,'powered-off.checkpoint'),suspended,{flag:'wx'});
  run(120000000);const held=await frame('off-after-ten-seconds');
  assert.equal(held.instructions,off.instructions,'Power_OFF cannot keep executing the branch loop');assert(held.sleeping&&!!(held.clock[3]&8));
  restore(suspended);assert.deepEqual(save(),suspended,'Power_OFF checkpoint must round-trip exactly');
  report.off_checkpoint={bytes:suspended.length,version:new DataView(suspended.buffer,suspended.byteOffset).getUint32(8,true),sha256:sha256(suspended),roundtrip_equal:true};
  tap(56);run(80000000);const woke=await frame('wake');
  assert(!(woke.clock[3]&8));assert(!woke.sleeping);
  assert.equal(woke.frame_sha256,before.frame_sha256,'Stock ON resume must retain the previous arithmetic/history screen');
  for(const scan of [24,3,17,6])tap(scan);run(20000000);
  const calculated=await frame('new-calculation');
  assert(calculated.lit_pixels>0);assert.notEqual(calculated.frame_sha256,before.frame_sha256,'Physical 7×8 ENTER must change the stock LCD');
  report.arithmetic={before:'1+1',after:'7*8',previous_frame_restored:true,new_frame_changed:true,
    note:'The private LCD captures require visual review to assert the rendered results 2 and 56; this tool does not parse or patch guest calculator objects.'};
  report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1;console.error(error.message);}
report.final_state=state();
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:report.passed,model,power_off:report.power_off,error:report.error}));
