// SPDX-License-Identifier: MIT
// Local firmware experiment only. No ROM acquisition, fixture or saved RAM is published.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { applySetup, setupHash } from '../web/hp48.js';
if(process.argv.length!==4)throw new Error('Usage: node tools/probe-checkpoint.mjs ROM-DIRECTORY NEW-REPORT.json');
const [dir,out]=process.argv.slice(2),wasm=await readFile('dist/orchard.wasm');
const sha=b=>createHash('sha256').update(b).digest('hex');
const temp=await mkdtemp(resolve(tmpdir(),'orchard-checkpoint-'));
const results=[];
function events(model){
 const list=model===1?[[50000000,40,3000000]]:[[60000000,40,5000000],[120000000,40,5000000]];
 const start=model===1?120000000:180000000;
 for(const [offset,key] of [[0,26],[10,5],[20,19],[30,6],[60,24],[70,3],[80,17],[90,6]])list.push([start+offset*1000000,key,2000000]);
 return list.flatMap(([t,scan,hold])=>[{t,scan,down:1},{t:t+hold,scan,down:0}]);
}
function tick(c){const s=new Uint32Array(c.memory.buffer,c.snapshot(),33);return s[22]+s[23]*4294967296;}
function run(c,end,keys){let at=tick(c),i=keys.findIndex(e=>e.t>=at);if(i<0)i=keys.length;
 while(at<end){while(i<keys.length&&keys[i].t===at){const e=keys[i++];assert.equal(c.keyboard_matrix(Math.floor(e.scan/7),e.scan%7,e.down),0);}
  const n=Math.min(256,end-at,(keys[i]?.t??end)-at);assert(n>0);assert.equal(c.run(n),0);at+=n;c.uart_receive();
 }
}
function save(c){assert.equal(c.checkpoint_save(),0);return new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();}
function load(c,state){new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),state.length).set(state);assert.equal(c.checkpoint_load(state.length),0);}
try{
 for(const [model,name,preset,split,end,expected] of [[1,'39g+.bin','hp39-home',160000000,230000000,'efec8205f401a7189f3cd77eeaac6947165d480b383033c9796c86e95e9f6968'],[4,'48gii.bin','hp48-home',220000000,300000000,'53a2eda0fe1c185236eda700cfaa6328fbb14bd89c8ffbe0b5ffde097bf527e9']]){
  const path=resolve(dir,name),rom=await readFile(path);assert.equal(sha(rom),setupHash(preset));
  async function create(){const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});c.create(model);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);return c;}
  const a=await create();applySetup(a,model,preset);const keys=events(model);
  run(a,split,keys);const saved=save(a); // already HOME, first calculation finished
  run(a,end,keys);const uninterrupted=save(a);
  const b=await create(),start=performance.now();load(b,saved);const restore_ms=performance.now()-start;
  assert.equal(tick(b),split);assert.deepEqual(save(b),saved);
  run(b,end,keys);assert.deepEqual(save(b),uninterrupted,'Continuation after restore differs');
  assert.equal(b.frame_view(1),0);const frame=sha(new Uint8Array(b.memory.buffer,b.frame_buffer(),131*64));assert.equal(frame,expected);
  const input=resolve(temp,`${model}-input.state`),output=resolve(temp,`${model}-native.state`);
  await writeFile(input,uninterrupted,{flag:'wx'});
  const child=spawnSync(resolve('build/orchard-checkpoint-replay'),[String(model),path,input,'50000',output],{encoding:'utf8',timeout:30000});
  if(child.error)throw child.error;assert.equal(child.status,0,child.stderr);
  run(b,end+50000,[]);assert.deepEqual(save(b),new Uint8Array(await readFile(output)),'Native/WASM portable resume differs');
  results.push({model,rom_sha256:sha(rom),saved_at:split,checkpoint_bytes:saved.length,restore_ms,
   second_calculation:'7*8=56',final_frame_sha256:frame,uninterrupted_and_restored_equal:true,native_wasm_resume_equal:true});
  console.log(`${name}: restored after 1+2; continued to 7*8=56; full serialized state and native/WASM resume match (${restore_ms.toFixed(1)} ms import).`);
 }
 await writeFile(out,JSON.stringify({schema:1,wasm_sha256:sha(wasm),results,boundary:'Local core checkpoint imports; excludes browser file-picker, ROM loading and WASM compilation. Declared board hypotheses unchanged.'},null,2)+'\n',{flag:'wx'});
}finally{await rm(temp,{recursive:true,force:true});}
