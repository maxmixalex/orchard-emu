// SPDX-License-Identifier: MIT
// Local-only, identical-workload comparison. Never fetches firmware or runs in CI.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { applySetup, setupHash } from '../web/hp48.js';
import { canonicalCheckpoint } from './checkpoint-equivalence.mjs';
const args=process.argv.slice(2);
if(args.length<4||args.length>5||args.length===5&&args[4]!=='--full')throw new Error('Usage: node tools/benchmark.mjs BASELINE.wasm CANDIDATE.wasm ROM-DIRECTORY NEW-REPORT.json [--full]');
const [beforePath,afterPath,romDir,outPath]=args, full=args[4]==='--full';
const sha=x=>createHash('sha256').update(x).digest('hex');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
function schedule(model){
 const list=model===1?[[50000000,40,3000000]]:[[60000000,40,5000000],[120000000,40,5000000]];
 const start=model===1?120000000:180000000;
 for(const [offset,key] of [[0,26],[10,5],[20,19],[30,6],[60,24],[70,3],[80,17],[90,6]])list.push([start+offset*1000000,key,2000000]);
 return list.flatMap(([t,scan,hold])=>[{t,scan,down:1},{t:t+hold,scan,down:0}]);
}
const inputs=[await readFile(beforePath),await readFile(afterPath)];
const reports=[];
for(const [model,name,preset,budget,expected] of [[1,'39g+.bin','hp39-home',230000000,'efec8205f401a7189f3cd77eeaac6947165d480b383033c9796c86e95e9f6968'],[4,'48gii.bin','hp48-home',300000000,'53a2eda0fe1c185236eda700cfaa6328fbb14bd89c8ffbe0b5ffde097bf527e9']]){
 const rom=await readFile(resolve(romDir,name));assert.equal(sha(rom),setupHash(preset));
 const events=full?schedule(model):[],ticks=full?budget:20000000;
 const results=[],time=[[],[]],wireCheckpoints=[];let canonicalReference=null;
 for(let repeat=0;repeat<(full?1:3);repeat++)for(const variant of repeat%2?[1,0]:[0,1]){
  const {instance:{exports:c}}=await WebAssembly.instantiate(inputs[variant],{});
  c.create(model);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);applySetup(c,model,preset);
  let at=0,status=0,spent=0;const uart=createHash('sha256');
  const start=performance.now();
  while(spent<ticks&&!status){
   while(at<events.length&&events[at].t===spent){const e=events[at++];assert.equal(c.keyboard_matrix(Math.floor(e.scan/7),e.scan%7,e.down),0);}
   const budget=Math.min(256,ticks-spent,(events[at]?.t??ticks)-spent);assert(budget>0);
   status=c.run(budget);spent+=budget;
   const n=c.uart_receive();if(n)uart.update(new Uint8Array(c.memory.buffer,c.uart_output(),n));
  }
  const ms=performance.now()-start;time[variant].push(ms);assert.equal(status,0);
  assert.equal(c.frame_view(1),0);assert.equal(c.annunciators(),0);
  const state={cpu:[...new Uint32Array(c.memory.buffer,c.snapshot(),33)],peripherals:[...new Uint32Array(c.memory.buffer,c.peripheral_snapshot(),10)],usb:[...new Uint32Array(c.memory.buffer,c.usb_snapshot(),44)],
   segments:[...new Uint8Array(c.memory.buffer,c.annunciator_buffer(),6)],frame:sha(new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64)),uart:uart.digest('hex'),
   aliases:[c.sram_alias_reads().toString(),c.sram_alias_writes().toString()],lcd:c.lcd_probe68_reads().toString(),events:at};
  assert.equal(c.checkpoint_save(),0);
  const wire=Buffer.from(new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()));
  const canonical=Buffer.from(canonicalCheckpoint(wire));
  if(canonicalReference)assert(canonical.equals(canonicalReference),'Complete canonical checkpoint differs');
  else canonicalReference=canonical;
  wireCheckpoints.push({variant:variant?'candidate':'baseline',repeat:repeat+1,version:wire.readUInt32LE(8),sha256:sha(wire)});
  state.canonical_checkpoint_sha256=sha(canonical);
  if(results.length)assert.deepEqual(state,results[0],'Baseline/candidate or independent cold replay differs');
  results.push(state);if(full)assert.equal(state.frame,expected);
  console.log(`${name} ${variant?'candidate':'baseline'} ${repeat+1}: ${(ms/1000).toFixed(3)} s, state matches`);
 }
 reports.push({model,ticks,events,baseline_ms:time[0],candidate_ms:time[1],speedup:median(time[0])/median(time[1]),state:results[0],wire_checkpoints:wireCheckpoints,canonical_checkpoint_equal:true});
}
const output={schema:'orchard-identical-work-benchmark-v1',host:process.version,platform:process.platform,architecture:process.arch,
 baseline_wasm:sha(inputs[0]),candidate_wasm:sha(inputs[1]),full_stock_replay:full,measures:'core execution in Node/V8; excludes loading, WASM compilation and browser task scheduling; no real-calculator timing comparison',reports};
output.checkpoint_comparison='Exact v1/v2 checksum and schema validation, followed by v1 migration with only the documented SDI reset fields inserted; every canonical byte is compared.';
output.checkpoint_equivalence_sha256=sha(await readFile(new URL('./checkpoint-equivalence.mjs',import.meta.url)));
await writeFile(outPath,JSON.stringify(output,null,2)+'\n',{flag:'wx'});
