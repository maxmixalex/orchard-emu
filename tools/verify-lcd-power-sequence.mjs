// SPDX-License-Identifier: MIT
// Original-ROM LCD self-test, observing ENVID and raw framebuffer order.
// Factory checkpoints must come from verify-flash-selftests.mjs. No observer,
// guest write, text substitution or white-frame suppression is used.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {applySetup} from '../web/hp48.js';
import {sha256} from './rom-inputs.mjs';
const usage='Usage: node tools/verify-lcd-power-sequence.mjs WASM ROM-DIRECTORY FACTORY-CHECKPOINT-DIRECTORY NEW-PRIVATE-OUTPUT';
if(process.argv[2]==='--help'){console.log(usage);process.exit(0);}
assert.equal(process.argv.length,6,usage);
const [wasmPath,input,factories,out]=process.argv.slice(2).map(x=>resolve(x)),wasm=await readFile(wasmPath);await mkdir(out);
const report={schema:'orchard-lcd-power-sequence-v1',wasm_sha256:sha256(wasm),tool_sha256:sha256(await readFile(new URL(import.meta.url))),
  observer_enabled:false,guest_memory_patched:false,physical_hardware_validated:false,frame_view:'packed-lsb',models:[],passed:false};
try{
  for(const [model,name,preset,romHash]of[
    [2,'hp39gs','hp39gs-home','a431b5d61af36aeaffec02a395da648b01507c3b5acc9d325f113384483680ff'],
    [5,'hp49gplus','hp49-home','3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab'],
  ]){
    const dir=join(out,String(model));await mkdir(dir);const rom=await readFile(join(input,name+'-full.bin'));assert.equal(sha256(rom),romHash);
    const c=(await WebAssembly.instantiate(wasm,{})).instance.exports;assert.equal(c.create(model),0);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);applySetup(c,model,preset);
    const state=()=>new Uint32Array(c.memory.buffer,c.snapshot(),33).slice(),reg=()=>new Uint32Array(c.memory.buffer,c.peripheral_snapshot(),6).slice();
    const height=model===5?80:64;let tick=0,enabled=false,edges=[],offBytes=null;
    const row={model,rom_sha256:romHash,keys:[],frames:[]};report.models.push(row);
    function restore(bytes){new Uint8Array(c.memory.buffer,c.checkpoint_buffer(bytes.length),bytes.length).set(bytes);assert.equal(c.checkpoint_load(bytes.length),0);const s=state();tick=s[22]+s[23]*2**32;enabled=Boolean(reg()[0]&1);}
    function saved(){assert.equal(c.checkpoint_save(),0);return new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();}
    function raw(){assert.equal(c.frame_view(1),0);return new Uint8Array(c.memory.buffer,c.frame_buffer(),131*height).slice();}
    async function frame(label){const p=raw(),r=reg(),s=state();await writeFile(join(dir,label+'.pgm'),Buffer.concat([Buffer.from(`P5\n131 ${height}\n255\n`),p.map(x=>255-x)]),{flag:'wx'});const item={label,tick,lcd_control:r[0],scan_serial:r[4]+r[5]*2**32,frame_sha256:sha256(p),pc:s[15],stop_status:s[28]};row.frames.push(item);return item;}
    async function run(n,observe=true){while(n){const count=Math.min(n,1024);assert.equal(c.run(count),0,JSON.stringify(Array.from(state())));tick+=count;n-=count;const value=Boolean(reg()[0]&1);if(observe&&value!==enabled){edges.push({tick,enabled:value});if(!value)offBytes=saved();}enabled=value;}}
    function key(scan,down){assert.equal(c.keyboard_matrix(Math.floor(scan/7),scan%7,+down),0);row.keys.push({scan,down,tick});}
    async function tap(scan){key(scan,true);await run(1500000);key(scan,false);await run(9000000);}
    const factory=await readFile(join(factories,String(model),'factory-menu.checkpoint'));row.factory_checkpoint_sha256=sha256(factory);restore(factory);
    await tap(26);await run(120000000);await frame('contrast');
    await tap(6);const before=await frame('before-off');await run(30000000);await frame('after-on');
    assert.equal(edges.length,2,'Expected one LCD disable/enable pair');assert.deepEqual(edges.map(x=>x.enabled),[false,true]);assert(offBytes);
    row.coarse_edges=edges;restore(offBytes);await run(edges[1].tick-tick-1024,false);assert.equal(Boolean(reg()[0]&1),false);
    const start=tick;while(!(reg()[0]&1)){assert(tick-start<1024,'Enable edge left the coarse bracket');assert.equal(c.run(1),0);tick++;}
    enabled=true;row.enable_tick=tick;const first=await frame('first-enabled');assert.equal(first.frame_sha256,before.frame_sha256,'First enabled RAM image differs from the pre-off text');
    await writeFile(join(dir,'first-enabled.checkpoint'),saved(),{flag:'wx'});
    await run(4096,false);await frame('enabled-plus-4096');await run(61440,false);const updated=await frame('enabled-plus-65536');assert.notEqual(updated.frame_sha256,before.frame_sha256,'Firmware did not update the text');
    row.initial_enabled_matches_before_off=true;row.content_changed_by_ticks=65536;row.passed=true;
    console.log(JSON.stringify({model,enable_tick:row.enable_tick,first_enabled_sha256:first.frame_sha256,after_65536_sha256:updated.frame_sha256}));
  }
  report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error.stack);}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
