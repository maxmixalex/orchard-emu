// SPDX-License-Identifier: MIT
// Optional original-ROM display-segment study. Never downloads firmware, never
// writes guest RAM and never runs in ordinary CI. Captures guest-produced pixels.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { applySetup, setupHash } from '../web/hp48.js';
if(process.argv.length!==5)throw new Error('Usage: node tools/probe-annunciators.mjs (hp48-home|hp39-home) NOR NEW-REPORT.json');
const [preset,path,output]=process.argv.slice(2),model=preset==='hp48-home'?4:preset==='hp39-home'?1:0;
assert(model,'Unknown study');
const rom=await readFile(path),hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(hash(rom),setupHash(preset),'This study requires the declared immutable full NOR');
const wasm=await readFile(new URL('../dist/orchard.wasm',import.meta.url));
const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
assert.equal(c.create(model),0);
new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);applySetup(c,model,preset);
let tick=0;const records=[],events=[];
function run(to){while(tick<to){const n=Math.min(256,to-tick);const status=c.run(n);if(status)throw new Error('Guest diagnostic stop: '+JSON.stringify([...new Uint32Array(c.memory.buffer,c.snapshot(),33)]));tick+=n;c.uart_receive();}}
function key(scan,down){const status=scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):c.keyboard_dedicated([0,4,5,6][scan-56],+down);assert.equal(status,0);events.push({tick,scan,down:+down});}
function capture(name){
 const status=c.annunciators(),levels=[...new Uint8Array(c.memory.buffer,c.annunciator_buffer(),6)];
 assert.equal(c.frame_view(1),0);const pixels=Buffer.from(new Uint8Array(c.memory.buffer,c.frame_buffer(),c.profile(model,2)*c.profile(model,3)));
 records.push({name,tick,status,levels,frame_sha256:hash(pixels),state:[...new Uint32Array(c.memory.buffer,c.snapshot(),33)]});
 console.log(name,tick,levels);return pixels;
}
if(model===4){run(60000000);key(40,true);run(65000000);key(40,false);run(120000000);key(40,true);run(125000000);key(40,false);}
else {run(50000000);key(40,true);run(53000000);key(40,false);}
run(160000000);capture('HOME baseline');
for(const scan of (model===4?[58,58,59,59,57,57,57,57]:[59,59,58,58,58,58])){
 key(scan,true);run(tick+2000000);capture(`key ${scan} down`);key(scan,false);run(tick+3000000);capture(`key ${scan} released`);
}
const report={schema:'orchard-packed-segments-v1',preset,rom_sha256:hash(rom),wasm_sha256:hash(wasm),events,records,
 interpretation:'Packed x=131, rows 0..5; reference routing requires original firmware confirmation. No physical wiring certificate.'};
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
