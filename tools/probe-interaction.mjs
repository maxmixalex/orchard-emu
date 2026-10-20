// SPDX-License-Identifier: MIT
// Optional local original-NOR check. No firmware or initial RAM is distributed.
// Historical fixed-timing witness: HP39 125/75 ms and HP48 50/30 ms.
// These values do not follow the production Worker defaults. Use the explicit
// --hold/--gap options of probe-input-dwell.mjs for release-gap candidates.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {applySetup,setupHash,TapQueue} from '../web/hp48.js';
import {defaultBindings} from '../web/preferences.js';
if(process.argv.length!==4)throw new Error('Usage: node tools/probe-interaction.mjs ROM-DIRECTORY NEW-REPORT.json');
const [dir,out]=process.argv.slice(2),wasm=await readFile('dist/orchard.wasm');
const hash=b=>createHash('sha256').update(b).digest('hex'),results=[];
for(const [model,name,preset,bootEnd] of [[1,'39g+.bin','hp39-home',100000000],[4,'48gii.bin','hp48-home',160000000]]){
 const rom=await readFile(resolve(dir,name));assert.equal(hash(rom),setupHash(preset));
 const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});c.create(model);
 new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);applySetup(c,model,preset);
 let tick=0;const events=[];const key=(scan,down,at=tick)=>{const r=scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,Number(down)):c.keyboard_dedicated([0,4,5,6][scan-56],Number(down));assert.equal(r,0);events.push({tick:at,scan,down:Number(down)});};
 const run=end=>{while(tick<end){const n=Math.min(1024,end-tick);assert.equal(c.run(n),0);tick+=n;c.uart_receive();}};
 const frame=()=>{assert.equal(c.frame_view(1),0);return new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();};
 const save=()=>{assert.equal(c.checkpoint_save(),0);return new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();};
 const load=(bytes,at)=>{new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),bytes.length).set(bytes);assert.equal(c.checkpoint_load(bytes.length),0);tick=at;};
 const f6=model===1?[50000000]:[60000000,120000000];
 for(const at of f6){run(at);key(40,true);run(at+600000);key(40,false);run(at+5000000);}
 run(bootEnd);const home=save(),before=frame();
 await writeFile(out+`.${model}.home.pgm`,Buffer.concat([Buffer.from('P5\n131 64\n255\n'),Buffer.from(before.map(v=>255-v))]),{flag:'wx'});
 const transitions=[];let prev=hash(before);
 for(let t=bootEnd+120000;t<=bootEnd+24000000;t+=120000){run(t);const h=hash(frame());if(h!==prev){transitions.push(t-bootEnd);prev=h;}}
 load(home,bootEnd);
 const hold=model===1?1500000:600000,gap=model===1?900000:360000;
 const queue=new TapQueue(key,hold,gap);queue.pushMany([26,5,19,6]);
 function runKeys(end){while(tick<end){queue.update(tick);const n=Math.min(1024,end-tick,queue.boundary(tick)-tick);assert(n>0);assert.equal(c.run(n),0);tick+=n;c.uart_receive();}queue.update(tick);}
 runKeys(bootEnd+20000000);const first=frame();queue.pushMany([24,3,17,6]);runKeys(bootEnd+40000000);const second=frame();
 await writeFile(out+`.${model}.result.pgm`,Buffer.concat([Buffer.from('P5\n131 64\n255\n'),Buffer.from(second.map(v=>255-v))]),{flag:'wx'});
 const expected=model===1?'efec8205f401a7189f3cd77eeaac6947165d480b383033c9796c86e95e9f6968':'53a2eda0fe1c185236eda700cfaa6328fbb14bd89c8ffbe0b5ffde097bf527e9';
 assert.equal(hash(second),expected,'Short-key arithmetic differs from established original-OS frame');
 let macroHash=null,editingTransitions=[];
 if(model===1){load(home,bootEnd);queue.clear(tick);queue.pushMany(defaultBindings(1).KeyA);runKeys(bootEnd+12000000);const macro=frame();macroHash=hash(macro);let ph=macroHash;for(let end=tick+120000,limit=tick+24000000;end<=limit;end+=120000){run(end);const next=hash(frame());if(next!==ph){editingTransitions.push(tick-bootEnd-12000000);ph=next;}}await writeFile(out+'.A.pgm',Buffer.concat([Buffer.from('P5\n131 64\n255\n'),Buffer.from(macro.map(v=>255-v))]),{flag:'wx'});}
 results.push({model,rom_sha256:hash(rom),bootEnd,press_ticks:hold,release_ticks:gap,first_frame_sha256:hash(first),result_frame_sha256:hash(second),macro_A_frame_sha256:macroHash,idle_frame_changes:transitions,editing_frame_changes:editingTransitions,key_events:events});
 console.log(name, 'result',hash(second),'idle',transitions);
}
await writeFile(out,JSON.stringify({schema:1,wasm_sha256:hash(wasm),results,boundary:'Original firmware, conditional board setup; visual result review required. Frame changes may include non-cursor changes. Virtual clock, not measured real-device timing.'},null,2)+'\n',{flag:'wx'});
