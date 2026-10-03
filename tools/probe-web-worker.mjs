// SPDX-License-Identifier: MIT
// Optional local firmware integration for the production Worker, using Node globals.
// This is not HTTP/browser DOM E2E. Never called by ordinary CI.
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HP48_ROM } from '../web/hp48.js';
if(process.argv.length!==4)throw new Error('Usage: node tools/probe-web-worker.mjs HP48GII-NOR NEW-REPORT.json');
const bytes=await readFile(process.argv[2]);assert.equal(createHash('sha256').update(bytes).digest('hex'),HP48_ROM);
const w=new Worker(new URL('../tests/web-worker-node.mjs',import.meta.url),{type:'module'});
const send=(type,extra={})=>w.postMessage({type,generation:1,...extra});
const stages=[[60000000,[40]],[120000000,[40]],[180000000,[26,5,19,6]],[240000000,[24,3,17,6]]];
let stage=0,done=false,loaded=false,stopping=false;
const deadline=setTimeout(()=>{console.error('Production Worker firmware witness timed out');w.terminate();process.exitCode=1;},900000);
let resolve,reject;const result=new Promise((a,b)=>{resolve=a;reject=b;});
w.on('error',reject);
w.on('message',async d=>{
 try{
  if(d.type==='ready')send('create',{model:4,preset:'hp48-home'});
  if(d.type==='created')send('load',{rom:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  if(d.type==='loaded'){loaded=true;send('run');}
  if(d.type==='error'||d.type==='fatal')throw new Error(d.message);
  if(d.type!=='snapshot'||!loaded)return;
  assert.equal(d.state[28],0,`Worker stopped: ${d.reason}`);
  const tick=d.state[22]+d.state[23]*4294967296;
  if(d.running&&stage<stages.length&&tick>=stages[stage][0]){
   for(const scan of stages[stage][1])send('tap',{scan});
   console.log(`Worker stage ${++stage} at ${tick}`);
  }
  if(d.running&&tick>=300000000&&!stopping){stopping=true;send('pause');}
  if(stopping&&!d.running&&!done){
   done=true;assert.equal(d.pending,0);assert.equal(d.events.length,20);
   assert.equal(d.aliasReads,'1');assert.equal(d.aliasWrites,'0');assert.equal(d.state[18],0);assert.equal(d.state[19],0);
   const frameHash=createHash('sha256').update(d.pixels).digest('hex');
   assert.equal(frameHash,'53a2eda0fe1c185236eda700cfaa6328fbb14bd89c8ffbe0b5ffde097bf527e9','Original HOME calculation frame differs');
   const report={schema:'orchard-node-production-worker-v1',rom_sha256:HP48_ROM,ticks:tick,state:Array.from(d.state),key_events:d.events,
    frame_sha256:frameHash,sram_alias_reads:d.aliasReads,sram_alias_writes:d.aliasWrites,lcd_reads:d.lcdReads,
    assumptions:'Explicit hp48-home setup; Node Worker adapter, not browser-origin E2E'};
   await writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
   await writeFile(process.argv[3]+'.pixels',d.pixels,{flag:'wx'});resolve(report);
  }
 }catch(e){reject(e);}
});
try{const report=await result;console.log(JSON.stringify(report));}finally{clearTimeout(deadline);await w.terminate();}
