// SPDX-License-Identifier: MIT
// Original downloaded HP39 programs: stock upload, physical input, warm return.
// Private ROMs, programs, LCD images and checkpoints are caller-owned inputs/outputs.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, basename} from 'node:path';
import {createHash} from 'node:crypto';
import {HP39_ROM, HP39GS_ROM, applySetup} from '../web/hp48.js';
import {inspectHp39File} from '../web/hp39-files.js';
import {VirtualUSB} from '../web/virtual-usb.js';
import {FileTransfer} from '../web/file-transfer.js';

const usage='Usage: node tools/verify-hp39-programs.mjs FULL-NOR PROGRAM NEW-PRIVATE-OUTPUT tetris|arkalite|hanoi [--wasm FILE] [--checkpoint INSTALLED]';
if(process.argv[2]==='--help'){console.log(usage);process.exit(0);}
assert(process.argv.length>=6,usage);
const scenario=process.argv[5];assert(['tetris','arkalite','hanoi'].includes(scenario),usage);
const [romPath, programPath, out]=process.argv.slice(2,5).map(p=>resolve(p));
let wasmPath=resolve('dist/orchard.wasm'),checkpointPath=null;
const options=process.argv.slice(6);
while(options.length){const option=options.shift(),value=options.shift();assert(value,usage);
  if(option==='--wasm')wasmPath=resolve(value);else if(option==='--checkpoint')checkpointPath=resolve(value);else throw Error(usage);}
if(scenario==='arkalite')assert(checkpointPath,'Arkalite requires its library and aplet installed by verify-hp39-wire-batch');
const sha=b=>createHash('sha256').update(b).digest('hex');
const [rom, program, wasm]=await Promise.all([readFile(romPath),readFile(programPath),readFile(wasmPath)]);
const profiles={
  tetris:{sha256:'2bf02af38f7ecb65900cc1ef2776484212a4fb2b9710b97b85f32c2fd828315e',url:'https://www.hpcalc.org/hp39/games/tetris39gpls.zip'},
  arkalite:{sha256:'1f4cda18268ba3be4e60fd4044770a38696c26b85f26aed911580243e1c82312',url:'https://www.hpcalc.org/hp39/games/arkalite40.zip'},
  hanoi:{sha256:'4b84e3946e159f960db128cc56257f3d7df6351ea7e593ba4ac247e0f6ace4c6',url:'https://www.hpcalc.org/hp39/games/hanoi39.zip'},
};
assert.equal(sha(program),profiles[scenario].sha256,'Scenario requires its unchanged downloaded program');
const model=sha(rom)===HP39_ROM?1:sha(rom)===HP39GS_ROM?2:0;
assert(model,'Use an unchanged admitted HP39g+/HP39gs ROM');
if(scenario==='tetris')assert.equal(model,1,'The original Tetris+ package declares HP39g+ only');
assert.equal(inspectHp39File(program).kind,'B');
await mkdir(out);
const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
assert.equal(c.create(model),0);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);
applySetup(c,model,model===1?'hp39-home':'hp39gs-home');
const report={schema:'orchard-hp39-original-program-v1',model,program:basename(programPath),rom_sha256:sha(rom),
  source_url:profiles[scenario].url,program_sha256:sha(program),wasm_sha256:sha(wasm),original_program_unchanged:true,cold_boot:!checkpointPath,
  guest_memory_patched:false,browser_end_to_end:false,keys:[],frames:[],transfers:[],passed:false};
let tick=0,request=0,transferError='';
const hz=c.timebase_hz(),state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));
const usb=new VirtualUSB(c,hz,event=>{if(event.error)transferError=event.error;});
const transfer=new FileTransfer({core:c,usb,model,notify:event=>{
  if(event.type==='file-transfer-status')report.transfers.push({tick,...event});
  if(event.phase==='error')transferError=event.error;
}});
function run(n){while(n){const q=Math.min(8192,n),status=c.run(q);tick+=q;n-=q;
  assert.equal(status,0,JSON.stringify(state()));if(usb.connected)usb.poll(tick);transfer.poll(tick);
  assert(!transferError,transferError);
}}
function key(scan,down){report.keys.push({tick,scan,down});assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):c.keyboard_dedicated([0,4,5,6][scan-56],+down),0);}
function tap(scan){key(scan,true);run(2000000);key(scan,false);run(2000000);}
function until(predicate,ticks,label){const end=tick+ticks;while(!predicate()&&tick<end)run(Math.min(8192,end-tick));assert(predicate(),label);}
// Independently viewed stock HOME calculation: rows 16..55 show 1+1 and 2.
// Excluding the header permits each installed aplet's own name. A changing game
// image, a stale title or an exception-handler loop cannot satisfy this oracle.
const arithmeticSHA='59a6894b2f4bd4cad5e07a5310e3cbb5a46ccaf521c4b25b3dbe08012ee13015';
async function save(name){assert.equal(c.checkpoint_save(),0);const data=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();await writeFile(resolve(out,name+'.checkpoint'),data,{flag:'wx'});return data;}
async function frame(name){assert.equal(c.frame_view(1),0);const data=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();
  await writeFile(resolve(out,name+'.pgm'),Buffer.concat([Buffer.from('P5\n131 64\n255\n'),Buffer.from(data.map(v=>255-v))]),{flag:'wx'});
  const item={name,tick,sha256:sha(data),arithmetic_area_sha256:sha(data.subarray(131*16,131*56)),state:state()};report.frames.push(item);console.log(name,item.sha256);return item;
}
try{
  if(checkpointPath){const data=await readFile(checkpointPath);report.input_checkpoint_sha256=sha(data);
    const ptr=c.checkpoint_buffer(data.length);new Uint8Array(c.memory.buffer,ptr,data.length).set(data);assert.equal(c.checkpoint_load(data.length),0);
    const snapshot=state();tick=snapshot[22]+snapshot[23]*4294967296;run(3000000);
  }else{
    run(60000000);tap(40);run(70000000);tap(49);run(20000000);tap(39);run(3000000);tap(44);
    assert.equal(c.gpio_inputs(5,0x8e,2),0);usb.start(tick);until(()=>usb.phase==='ready',10*hz,'USB enumeration');
    transfer.start({request:++request,mode:'send',protocol:'hp39-wire',transport:'usb',name:basename(programPath),bytes:program},tick);
    tap(6);until(()=>!transfer.active,300*hz,'Stock Wire upload');assert.equal(transfer.session.phase,'complete');
    run(120000000);transfer.resetUsb(tick);usb.disconnect();assert.equal(c.gpio_inputs(5,0x8e,0),0);run(2000000);
  }
  await frame('installed');await save('installed');tap(scenario==='tetris'?6:40);run(20000000);await frame('title');
  tap(6);run(scenario==='hanoi'?2000000:24000000);const started=await frame('game');const game=await save('game');
  async function finish(suffix){
    if(scenario==='hanoi')run(72000000);
    else for(const scan of scenario==='tetris'?[45,43,59,58,44]:[43,45]){key(scan,true);run(12000000);key(scan,false);run(1200000);}
    const played=await frame('played'+suffix);assert.notEqual(played.sha256,started.sha256,'Program did not change the display');
    tap(scenario==='arkalite'?0:56);run(60000000);await frame('returned'+suffix);
    tap(48);run(12000000);for(const scan of [26,5,26,6])tap(scan);run(30000000);
    const arithmetic=await frame('one-plus-one'+suffix);
    assert.equal(arithmetic.arithmetic_area_sha256,arithmeticSHA,'Program did not return to stock HOME and calculate 1+1=2');
    return save('after'+suffix);
  }
  const after=await finish('');
  const ptr=c.checkpoint_buffer(game.length);new Uint8Array(c.memory.buffer,ptr,game.length).set(game);assert.equal(c.checkpoint_load(game.length),0);
  const snapshot=state();tick=snapshot[22]+snapshot[23]*4294967296;
  const restored=await finish('-restored');assert.deepEqual(restored,after,'Warm restore changed the complete program continuation');
  report.restored_continuation_exact=true;report.arithmetic_result_verified=true;
  assert.equal(sha(await readFile(romPath)),report.rom_sha256,'ROM changed during acceptance');
  assert.equal(sha(await readFile(programPath)),report.program_sha256,'Program changed during acceptance');
  assert.equal(sha(await readFile(wasmPath)),report.wasm_sha256,'WASM changed during acceptance');
  report.inputs_unchanged=true;report.passed=true;
}catch(error){report.error=String(error.stack||error);await frame('failure').catch(()=>{});process.exitCode=1;console.error(report.error);}
report.final_state=state();report.tool_sha256=sha(await readFile(new URL(import.meta.url)));
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log('Original program',report.passed?'PASSED':'FAILED');
