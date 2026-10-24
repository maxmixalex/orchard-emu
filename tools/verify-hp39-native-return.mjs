// SPDX-License-Identifier: MIT
// Private original-ROM continuation witness for the separately built GBP39 ALIGN4.
// Start from a checkpoint produced by verify-hp39-wire-batch; no guest writes.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectInput } from './rom-inputs.mjs';
const usage='Usage: node tools/verify-hp39-native-return.mjs FULL-NOR.bin INSTALLED.checkpoint NEW-PRIVATE-OUTPUT [--wasm FILE]';
if(process.argv.length===3&&process.argv[2]==='--help'){console.log(usage+'\nRequires the GBP39 ALIGN4 aplet selected in APLET. Checks START, F6 game, ON return and HOME 1+1. Output contains private frames/checkpoints.');process.exit(0);}
if(![5,7].includes(process.argv.length)||process.argv.length===7&&process.argv[5]!=='--wasm')throw Error(usage);
const [romPath,inputPath,out]=process.argv.slice(2,5).map(p=>resolve(p));
const wasmPath=resolve(process.argv[6]||'dist/orchard.wasm');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const [rom,input,wasm]=await Promise.all([readFile(romPath),readFile(inputPath),readFile(wasmPath)]);
const identity=inspectInput(rom),model=identity.models[0]==='hp39gplus'?1:identity.models[0]==='hp39gs'?2:0;
assert(model&&identity.kind==='full-nor-dump','Use a catalogued, unchanged HP39g+/HP39gs full NOR');
await mkdir(out);
const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});assert.equal(c.create(model),0);
new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);
const state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));
const tick=()=>{const s=state();return s[22]+s[23]*4294967296;};
function load(bytes){const ptr=c.checkpoint_buffer(bytes.length);assert(ptr);new Uint8Array(c.memory.buffer,ptr,bytes.length).set(bytes);assert.equal(c.checkpoint_load(bytes.length),0);}
function save(){assert.equal(c.checkpoint_save(),0);return new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();}
load(input);const start=tick();
const report={schema:'orchard-hp39-native-return-v1',model,rom_sha256:sha(rom),wasm_sha256:sha(wasm),input_checkpoint_sha256:sha(input),
 input_checkpoint_version:input.readUInt32LE(8),program:'GBP39 ALIGN4 diagnostic rebuild; not original GBP39 0.3',
 cold_boot:false,guest_memory_patched:false,rom_patched:false,hardware_validated:false,keys:[],frames:[],passed:false};
function run(n){while(n){const q=Math.min(n,65536),status=c.run(q);n-=q;const s=state();assert.equal(status,0,JSON.stringify(s));assert.equal(s[18],0,JSON.stringify(s));}}
function key(scan,down){report.keys.push({tick:tick(),scan,down});assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):c.keyboard_dedicated(scan===56?0:scan===58?5:6,+down),0);}
function tap(scan){key(scan,true);run(2000000);key(scan,false);run(2000000);}
async function frame(name){assert.equal(c.frame_view(1),0);const pixels=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();
 await writeFile(resolve(out,name+'.pgm'),Buffer.concat([Buffer.from('P5\n131 64\n255\n'),Buffer.from(pixels.map(v=>255-v))]),{flag:'wx'});
 const s=state(),item={name,tick:tick(),elapsed_ticks:tick()-start,frame_sha256:sha(pixels),dfsr:s[18],far:s[19],pc:s[15],sp:s[13],stop:s[28]};report.frames.push(item);console.log(name,item.frame_sha256);return item;}
try {
 run(3000000);await frame('installed');tap(40);run(20000000);
 assert.equal((await frame('song-select')).frame_sha256,'c629421f132788f0a2849a1d0cd6d79647a0068c6c1666e727eb66c80c7b98bb');
 tap(40);run(26000000);await frame('game');const game=save();
 await writeFile(resolve(out,'game.checkpoint'),game,{flag:'wx'});
 report.game_checkpoint_sha256=sha(game);report.checkpoint_version=new DataView(game.buffer).getUint32(8,true);
 tap(56);run(46000000);await frame('after-on');const returned=save();
 // Replay the same normal ON interaction from the warm-TLB checkpoint.
 load(game);tap(56);run(46000000);assert.deepEqual(save(),returned,'Restoring the native game changed its return');
 report.restored_return_identical=true;
 tap(48);run(10000000);await frame('home');for(const scan of [26,5,26,6])tap(scan);run(30000000);
 report.arithmetic=await frame('one-plus-one');
 assert.equal(report.arithmetic.frame_sha256,'3d74d84d096aca2df92fd38dbfef9c0c651292e224ff4c627ecdb583230ef826');
 await writeFile(resolve(out,'after.checkpoint'),save(),{flag:'wx'});report.passed=true;
}catch(error){report.error=String(error.stack||error);await frame('failure').catch(()=>{});process.exitCode=1;}
report.final_state=state();report.tool_sha256=sha(await readFile(new URL(import.meta.url)));
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log('HP39 ALIGN4 native return',report.passed?'PASSED':'FAILED');
