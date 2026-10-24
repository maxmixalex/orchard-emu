// SPDX-License-Identifier: MIT
// Local original-ROM witness. Private output contains LCDs and checkpoints;
// publish the JSON identities/results only, never firmware or private state.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {applySetup} from '../web/hp48.js';
const usage='Usage: node tools/verify-serial-selftests.mjs WASM ROM-DIRECTORY NEW-PRIVATE-OUTPUT-DIRECTORY';
if(process.argv.length===3&&process.argv[2]==='--help'){console.log(usage);process.exit(0);}
if(process.argv.length!==5)throw Error(usage);
const [wasmPath,input,out]=process.argv.slice(2).map(p=>resolve(p));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),wasm=await readFile(wasmPath);
const fixtures=[
 [1,'39g+.bin','hp39-home','95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67'],
 [2,'hp39gs-full.bin','hp39gs-home','a431b5d61af36aeaffec02a395da648b01507c3b5acc9d325f113384483680ff'],
 [4,'48gii.bin','hp48-home','4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937'],
 [5,'hp49gplus-full.bin','hp49-home','3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab'],
];
const expected={
 rs232:'86e320fdf08f59a730e43862e9177d61c5e760933dbc92022711d079b06ecda9',
 irda:'41295081afef512f68f936494ee4b99fe7827e999781bdee15dc6f0beeb8a508',
 irda1:'fd2542548dedbe8349a99b7fc7cbf6e7509b0c1bf58732efad10a42042b21a42',
 irda5:'75d37eb49f6cd2ba4a2f92b0ad79f6d9b548a3cac5ef8b78491151a403117b82',
};
await mkdir(out);
const report={schema:'orchard-original-serial-selftests-v1',wasm_sha256:sha(wasm),
 tool_sha256:sha(await readFile(new URL(import.meta.url))),cold_boot:true,
 physical_input_only:true,guest_memory_patched:false,physical_hardware_validated:false,models:[],passed:false};
try{
 for(const[model,file,preset,romHash]of fixtures){
  const dir=join(out,String(model));await mkdir(dir);
  const rom=await readFile(join(input,file));assert.equal(sha(rom),romHash,'Original ROM identity');
  const{instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
  assert.equal(c.create(model),0);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);
  assert.equal(c.load(rom.length),0);applySetup(c,model,preset);
  const row={model,preset,rom_sha256:romHash,frames:[],keys:[],host_tx_bytes:[0,0,0],passed:false};report.models.push(row);
  const state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));
  let tick=0;
  function run(n){while(n){const q=Math.min(n,1024);assert.equal(c.run(q),0,JSON.stringify(state()));
   tick+=q;n-=q;for(let ch=0;ch<3;ch++)row.host_tx_bytes[ch]+=c.uart_receive_channel(ch);}}
  function key(scan,down){assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):c.keyboard_dedicated([0,4,5,6][scan-56],+down),0);row.keys.push({tick,scan,down});}
  function tap(scan){key(scan,true);run(1500000);key(scan,false);run(9000000);}
  async function frame(label){assert.equal(c.frame_view(1),0);const height=model===5?80:64;
   const pixels=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*height).slice();
   await writeFile(join(dir,label+'.pgm'),Buffer.concat([Buffer.from(`P5\n131 ${height}\n255\n`),pixels.map(v=>255-v)]),{flag:'wx'});
   assert.equal(c.checkpoint_save(),0);const cp=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();
   await writeFile(join(dir,label+'.checkpoint'),cp,{flag:'wx'});
   const record={label,tick,frame_sha256:sha(pixels),checkpoint_sha256:sha(cp),stop:state()[28],
    uart:Array.from({length:3},(_,ch)=>Array.from(new Uint32Array(c.memory.buffer,c.uart_snapshot(ch),9)))};
   row.frames.push(record);console.log(model,label,record.frame_sha256);return record.frame_sha256;}
  run(60000000);key(40,true);run(1500000);key(40,false);run(58500000);
  if(model>=4){key(40,true);run(1500000);key(40,false);run(58500000);}
  await frame('home');
  key(56,true);run(1500000);key(38,true);run(1500000);key(38,false);run(600000);key(56,false);run(24000000);
  await frame('version');tap(35);const menu=await frame('menu');
  for(const[kind,scan]of[...(model===2||model===4?[['rs232',11]]:[]),['irda',model===1?18:17]]){
   tap(scan);assert.equal(await frame(kind),expected[kind+model]||expected[kind],'Stock diagnostic PASS image');
   tap(6);assert.equal(await frame(kind+'-returned'),menu,'ENTER must return to the same stock factory menu');
  }
  assert.deepEqual(row.host_tx_bytes,[0,0,0],'Factory diagnostics use internal loopback, not an optical mirror');
  row.passed=true;
 }
 report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;console.error(report.error);}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
