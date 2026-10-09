// SPDX-License-Identifier: MIT
// Local owned-ROM profile. Never fetches ROMs or confuses core decode with DOM paint.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {applySetup,setupHash} from '../web/hp48.js';
import {frameRGBA} from '../web/capture.js';
import assert from 'node:assert/strict';
const [directory,out]=process.argv.slice(2);if(!directory||!out)throw Error('Usage: node tools/profile-display.mjs ROM-DIR NEW-REPORT.json');
const wasm=await readFile('dist/orchard.wasm'),sha=x=>createHash('sha256').update(x).digest('hex'),results=[];
for(const [id,name,preset,end] of [[1,'39g+.bin','hp39-home',90000000],[4,'48gii.bin','hp48-home',150000000]]){
 const rom=await readFile(resolve(directory,name));assert.equal(sha(rom),setupHash(preset));const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
 c.create(id);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);applySetup(c,id,preset);
 const events=id===1?[[50000000,1],[53000000,0]]:[[60000000,1],[65000000,0],[120000000,1],[125000000,0]];let at=0,index=0;
 while(at<end){while(events[index]?.[0]===at)c.keyboard_matrix(5,5,events[index++][1]);const n=Math.min(1024,end-at,(events[index]?.[0]??end)-at);assert.equal(c.run(n),0);at+=n;c.uart_receive();}
 const saved=()=>{assert.equal(c.checkpoint_save(),0);return Buffer.from(new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()));};
 const before=saved(),samples=[];let pixels;
 for(let round=0;round<6;round++){const start=performance.now();for(let i=0;i<10000;i++){assert.equal(c.frame_view(1),0);c.annunciators();pixels=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();}samples.push((performance.now()-start)/10000);}
 assert.deepEqual(saved(),before,'Display inspection changed guest state');const frame={width:131,height:64,pixels,frameStatus:0};
 const rgbaStart=performance.now();for(let i=0;i<2000;i++)frameRGBA(frame);const rgba_ms=(performance.now()-rgbaStart)/2000;
 const median=samples.slice(1).sort((a,b)=>a-b)[2];results.push({id,frame_sha256:sha(pixels),decode_copy_ms:median,rgba_ms,decode_copy_ms_per_second_at_30fps:median*30,samples});
}
await writeFile(out,JSON.stringify({host:process.version,wasm:sha(wasm),scope:'Core LCD decode + indicators + pixel copy; CPU halted at same guest state. RGBA assembly measured separately. Excludes browser painting, React and Worker message delivery.',results},null,2),{flag:'wx'});console.log(results);
