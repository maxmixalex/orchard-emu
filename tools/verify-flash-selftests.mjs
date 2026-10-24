// SPDX-License-Identifier: MIT
// Original-ROM factory FLASH witness. Output includes private LCD/checkpoints.
// The expected hashes cover only the stock success text, never guest memory.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {applySetup} from '../web/hp48.js';

const usage='Usage: node tools/verify-flash-selftests.mjs WASM ROM-DIRECTORY NEW-PRIVATE-OUTPUT [--full]';
const args=process.argv.slice(2),full=args.at(-1)==='--full';if(full)args.pop();
if(args.length===1&&args[0]==='--help'){console.log(usage);process.exit(0);}
if(args.length!==3)throw Error(usage);
const[wasmPath,input,out]=args.map(p=>resolve(p)),wasm=await readFile(wasmPath);
const sha=b=>createHash('sha256').update(b).digest('hex');
const verified='76ffb8a4386d4b482976cfd2d6fc1e90d7f233c699863740092d7ad389189762';
const passed='52cd4c48a79db50b035c2d3875a7cf47fd642c86e2d0e60e6bc7478210a9422b';
const fixtures=[
 [2,'hp39gs-full.bin','hp39gs-home','a431b5d61af36aeaffec02a395da648b01507c3b5acc9d325f113384483680ff'],
 [5,'hp49gplus-full.bin','hp49-home','3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab'],
];
await mkdir(out);
const report={schema:'orchard-original-flash-selftests-v1',wasm_sha256:sha(wasm),
 tool_sha256:sha(await readFile(new URL(import.meta.url))),
 setup_sha256:sha(await readFile(new URL('../web/hp48.js',import.meta.url))),
 cold_boot:true,physical_input_only:true,guest_memory_patched:false,
 physical_hardware_validated:false,full_requested:full,models:[],passed:false};
try{
 for(const[model,file,preset,hash]of fixtures){
  const dir=join(out,String(model));await mkdir(dir);
  const rom=await readFile(join(input,file));assert.equal(sha(rom),hash,'Original complete ROM identity');
  const{instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
  assert.equal(c.create(model),0);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);
  assert.equal(c.load(rom.length),0);applySetup(c,model,preset);
  const row={model,preset,rom_sha256:hash,keys:[],frames:[],passed:false};report.models.push(row);
  let tick=0;
  const state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));
  function run(n){while(n){const q=Math.min(n,1000000),s=c.run(q);tick+=q;n-=q;assert.equal(s,0,JSON.stringify(state()));}}
  function key(scan,down){assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):c.keyboard_dedicated([0,4,5,6][scan-56],+down),0);row.keys.push({tick,scan,down});}
  function tap(scan){key(scan,true);run(1500000);key(scan,false);run(9000000);}
  function pixels(){assert.equal(c.frame_view(1),0);return new Uint8Array(c.memory.buffer,c.frame_buffer(),131*(model===5?80:64)).slice();}
  function waitText(hash,y,budget){const start=tick;while(sha(pixels().subarray(131*y,131*(y+8)))!==hash){assert(tick-start<budget,'Stock success text did not appear');run(12000000);}return tick-start;}
  async function frame(label){
   const p=pixels();assert.equal(c.checkpoint_save(),0);
   const cp=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();
   await writeFile(join(dir,label+'.pgm'),Buffer.concat([Buffer.from(`P5\n131 ${model===5?80:64}\n255\n`),p.map(v=>255-v)]),{flag:'wx'});
   await writeFile(join(dir,label+'.checkpoint'),cp,{flag:'wx'});
   row.frames.push({label,tick,frame_sha256:sha(p),checkpoint_sha256:sha(cp),checkpoint_bytes:cp.length,status:state()[28]});
   console.log(model,label,tick,sha(p));
  }
  run(60000000);tap(40);run(60000000);if(model===5){tap(40);run(60000000);}
  await frame('home');
  key(56,true);run(1500000);key(38,true);run(1500000);key(38,false);run(600000);key(56,false);run(24000000);
  tap(35);await frame('factory-menu');tap(12);
  row.verify_ticks=waitText(verified,0,2000000000);await frame('rom-verify');tap(6);await frame('write-menu');
  for(const[kind,scan,budget]of[['quick',26,2000000000],...(full?[['full',19,24000000000]]:[])]){
   const start=tick;tap(scan);waitText(passed,24,budget);row[kind+'_ticks']=tick-start;
   await frame(kind+'-passed');tap(6);
   // ENTER leaves the writer; the factory FLASH choice rechecks ROM first.
   if(kind==='quick'&&full){tap(12);waitText(verified,0,2000000000);tap(6);}
  }
  row.passed=true;
 }
 report.passed=true;
}catch(error){report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
