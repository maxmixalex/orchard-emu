// SPDX-License-Identifier: MIT
// Production Worker + real WASM + generated ARM instructions. No ROM fixture,
// simulated UART queue, or injected Worker output is used in this regression.
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {IRDA_SPAN_TICKS,IRDA_WINDOW_PACKETS} from '../web/irda-input.js';

const adapter=`
import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
globalThis.self=globalThis;
globalThis.postMessage=data=>parentPort.postMessage(data);
globalThis.fetch=async url=>{
  if(String(url)!==new URL('orchard.wasm',workerData.workerURL).href)throw Error('Unexpected asset request');
  return new Response(await readFile(new URL(workerData.wasmURL)),{status:200});
};
// The test-only batch delivers ordinary messages within one host task, so no
// scheduler task can advance guest time between enqueueing window packets.
parentPort.on('message',data=>{for(const message of data.testBatch??[data])self.onmessage?.({data:message});});
await import(workerData.workerURL);
`;
function guest(mode){
  const words=[0xea000000,0xeafffffe],literals=[];
  const ldr=(reg,value)=>{literals.push({index:words.length,reg,value});words.push(0);};
  ldr(0,0x53000000);words.push(0xe3a01000,0xe5801000); // Watchdog off.
  ldr(0,0x50008000);words.push(0xe3a01043,0xe5801000); // UART2, 8-bit IR.
  words.push(mode==='loopback'?0xe3a01025:mode==='disabled'?0xe3a01000:0xe3a01005,0xe5801004);
  if(mode==='echo'){
    // Poll the real URXH register and echo every admitted byte through UTXH.
    words.push(0xe5901010,0xe3110001,0x0afffffc,0xe5d01024,0xe5c01020,0xeafffff9);
  }else words.push(0xe3a01042,0xe5c01020); // Transmit B through the actual UTXH register.
  if(mode==='disable-after')words.push(0xe3a01000,0xe5801004);
  if(mode==='serial-after')words.push(0xe3a01003,0xe5801000);
  words.push(0xeafffffe);
  for(const {index,reg,value} of literals){words[index]=(0xe59f0000|(reg<<12)|(4*words.length-4*index-8))>>>0;words.push(value);}
  const rom=new Uint8Array(1048576).fill(255),view=new DataView(rom.buffer);
  words.forEach((value,index)=>view.setUint32(index*4,value,true));return rom;
}
for(const mode of ['enabled','disable-after','serial-after','loopback','unpaired','disabled']){
  const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(adapter)),{
    workerData:{workerURL:new URL('../web/worker.js',import.meta.url).href,wasmURL:new URL('../dist/orchard.wasm',import.meta.url).href}});
  const output=[],pending=[];
  worker.on('message',data=>{
    output.push(data);
    for(const entry of [...pending])if(entry.match(data)){clearTimeout(entry.timer);pending.splice(pending.indexOf(entry),1);entry.resolve(data);}
  });
  function wait(match){
    const existing=output.find(match);if(existing)return Promise.resolve(existing);
    return new Promise((resolve,reject)=>{const entry={match,resolve,timer:setTimeout(()=>reject(Error(`IR Worker timeout (${mode}): ${JSON.stringify(output.at(-1))}`)),10000)};pending.push(entry);});
  }
  const send=data=>worker.postMessage({generation:1,epoch:1,...data});
  try{
    await wait(data=>data.type==='ready');send({type:'create',model:2,preset:'strict',audience:'calculator'});
    await wait(data=>data.type==='created');send({type:'load',rom:guest(mode).buffer});
    await wait(data=>data.type==='loaded');send({type:'irda-connect',connected:mode!=='unpaired'});send({type:'run'});
    const state=await wait(data=>data.type==='snapshot'&&data.running&&data.tick>=1024);
    assert.equal(state.stopped,false,mode);
    assert.equal(output.some(data=>data.type==='error'||data.type==='fatal'),false,mode);
    const received=output.filter(data=>data.type==='irda-output').flatMap(data=>Array.from(data.bytes));
    assert.deepEqual(received,['enabled','disable-after','serial-after'].includes(mode)?[66]:[],mode);
  }finally{await worker.terminate();for(const entry of pending)clearTimeout(entry.timer);}
}
{
  const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(adapter)),{
    workerData:{workerURL:new URL('../web/worker.js',import.meta.url).href,wasmURL:new URL('../dist/orchard.wasm',import.meta.url).href}});
  const output=[],pending=[];
  worker.on('message',data=>{output.push(data);for(const entry of [...pending])if(entry.match(data)){clearTimeout(entry.timer);pending.splice(pending.indexOf(entry),1);entry.resolve(data);}});
  const wait=match=>{
    const old=output.find(match);if(old)return Promise.resolve(old);
    return new Promise((resolve,reject)=>{const entry={match,resolve,timer:setTimeout(()=>reject(Error('Timed IR Worker: '+JSON.stringify(output.at(-1)))),10000)};pending.push(entry);});
  };
  const send=data=>worker.postMessage({generation:1,epoch:1,...data});
  try{
    await wait(data=>data.type==='ready');send({type:'create',model:2,preset:'strict',audience:'calculator'});
    await wait(data=>data.type==='created');send({type:'load',rom:guest('echo').buffer});await wait(data=>data.type==='loaded');
    send({type:'configure',speed:0.5});send({type:'irda-connect',connected:true});send({type:'run'});
    await wait(data=>data.type==='snapshot'&&data.running&&data.tick>=1024);
    send({type:'irda-input',request:1,bytes:Uint8Array.of(21,22,23,24),segments:[[2,100],[2,100+IRDA_SPAN_TICKS]]});
    await wait(data=>data.type==='irda-input-result'&&data.request===1);
    await wait(data=>data.type==='irda-output'&&data.bytes.includes(24));
    const echoed=output.filter(data=>data.type==='irda-output');
    assert.deepEqual(echoed.flatMap(data=>Array.from(data.bytes)),[21,22,23,24]);
    const first=echoed.find(data=>data.bytes.includes(22)),last=echoed.find(data=>data.bytes.includes(23));
    assert(last.tick-first.tick>=IRDA_SPAN_TICKS-1024,'Source virtual interval reaches real UART execution');
    assert(output.filter(data=>data.type==='irda-input-progress'&&data.request===1).length>2,'Legal slow-speed wait reports actual guest progress');
    assert.deepEqual(output.filter(data=>data.type==='irda-input-result'&&data.request===1).map(({accepted,discarded})=>({accepted,discarded})),[{accepted:4,discarded:false}]);
    send({type:'irda-input',request:2,bytes:Uint8Array.of(88,99),segments:[[1,200+IRDA_SPAN_TICKS],[1,200+2*IRDA_SPAN_TICKS]]});
    const prefix=await wait(data=>data.type==='irda-output'&&data.bytes.includes(88));
    send({type:'irda-connect',connected:false,epoch:2});send({type:'irda-connect',connected:true,epoch:3});
    send({type:'irda-connect',connected:false,epoch:1});
    send({type:'irda-input',epoch:1,request:4,bytes:Uint8Array.of(66),segments:[[1,0]]});
    send({type:'irda-input',epoch:3,request:3,bytes:Uint8Array.of(77),segments:[[1,0]]});
    const cancelled=await wait(data=>data.type==='irda-input-result'&&data.request===2);
    assert.equal(cancelled.accepted,1);assert.equal(cancelled.discarded,true);
    const stale=await wait(data=>data.type==='irda-input-result'&&data.request===4);
    assert.equal(stale.accepted,0);assert.equal(stale.discarded,true);assert.equal(stale.epoch,1);
    await wait(data=>data.type==='irda-output'&&data.bytes.includes(77));
    send({type:'configure',speed:0});
    await wait(data=>data.type==='snapshot'&&data.tick>prefix.tick+IRDA_SPAN_TICKS+1024);
    assert.deepEqual(output.filter(data=>data.type==='irda-output').flatMap(data=>Array.from(data.bytes)),[21,22,23,24,88,77],'Disconnect/re-pair drops old future bytes without replacing the machine generation');
    assert.equal(output.some(data=>data.type==='error'||data.type==='fatal'),false);
  }finally{await worker.terminate();for(const entry of pending)clearTimeout(entry.timer);}
}
{
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(adapter)),{
  workerData:{workerURL:new URL('../web/worker.js',import.meta.url).href,wasmURL:new URL('../dist/orchard.wasm',import.meta.url).href}});
 const output=[],pending=[];
 worker.on('message',data=>{output.push(data);for(const entry of [...pending])if(entry.match(data)){clearTimeout(entry.timer);pending.splice(pending.indexOf(entry),1);entry.resolve(data);}});
 const wait=match=>{
  const old=output.find(match);if(old)return Promise.resolve(old);
  return new Promise((resolve,reject)=>{const entry={match,resolve,timer:setTimeout(()=>reject(Error('Pipelined IR Worker: '+JSON.stringify(output.at(-1)))),10000)};pending.push(entry);});
 };
 const send=data=>worker.postMessage({generation:1,epoch:1,...data});
 const batch=messages=>worker.postMessage({testBatch:messages.map(message=>({generation:1,epoch:1,...message}))});
 try{
  await wait(data=>data.type==='ready');send({type:'create',model:2,preset:'strict',audience:'calculator'});
  await wait(data=>data.type==='created');send({type:'load',rom:guest('echo').buffer});await wait(data=>data.type==='loaded');
  send({type:'irda-connect',connected:true});send({type:'run'});
  await wait(data=>data.type==='snapshot'&&data.running&&data.tick>=1024);
  const source=100,gap=4096;
  batch(Array.from({length:IRDA_WINDOW_PACKETS},(_,index)=>({type:'irda-input',request:index+1,
   bytes:Uint8Array.from(index===0?[51,52]:[59+index]),segments:index===0?[[1,source],[1,source+gap]]:[[1,source+gap]]})));
  await wait(data=>data.type==='irda-input-result'&&data.request===IRDA_WINDOW_PACKETS);
  await wait(data=>data.type==='irda-output'&&data.bytes.includes(59+IRDA_WINDOW_PACKETS-1));
  const results=output.filter(data=>data.type==='irda-input-result');
  assert.deepEqual(results.map(data=>data.request),Array.from({length:IRDA_WINDOW_PACKETS},(_,index)=>index+1));
  assert.equal(new Set(results.map(data=>data.tick)).size,1,'The real Worker consumes the already queued window at one virtual tick');
  assert(results.every((data,index)=>data.accepted===(index===0?2:1)&&!data.discarded&&!data.error));
  const expected=[51,52,...Array.from({length:IRDA_WINDOW_PACKETS-1},(_,index)=>60+index)];
  assert.deepEqual(output.filter(data=>data.type==='irda-output').flatMap(data=>Array.from(data.bytes)),expected);
  const future=source+gap+100+IRDA_SPAN_TICKS/2;
  batch([
   ...Array.from({length:IRDA_WINDOW_PACKETS},(_,index)=>({type:'irda-input',request:100+index,
    bytes:Uint8Array.from(index===0?[88,99]:[99+index]),segments:index===0?[[1,source+gap+100],[1,future]]:[[1,future]]})),
   {type:'irda-connect',connected:false,epoch:2},{type:'irda-connect',connected:true,epoch:3},
   {type:'irda-connect',connected:false,epoch:1},
   {type:'irda-input',request:900,epoch:1,bytes:Uint8Array.of(110),segments:[[1,0]]},
   {type:'irda-input',request:901,epoch:3,bytes:Uint8Array.of(77),segments:[[1,0]]},
  ]);
  await wait(data=>data.type==='irda-input-result'&&data.request===901);
  const cancelled=output.filter(data=>data.type==='irda-input-result'&&data.request>=100&&data.request<100+IRDA_WINDOW_PACKETS);
  assert.equal(cancelled.length,IRDA_WINDOW_PACKETS);
  assert(cancelled.every((data,index)=>data.epoch===1&&data.accepted===(index===0?1:0)&&data.discarded&&!data.error));
  const stale=output.find(data=>data.type==='irda-input-result'&&data.request===900);
  assert.equal(stale.epoch,1);assert.equal(stale.accepted,0);assert.equal(stale.discarded,true);
  await wait(data=>data.type==='irda-output'&&data.bytes.includes(77));send({type:'configure',speed:0});
  await wait(data=>data.type==='snapshot'&&data.tick>cancelled[0].tick+IRDA_SPAN_TICKS/2+1024);
  assert.deepEqual(output.filter(data=>data.type==='irda-output').flatMap(data=>Array.from(data.bytes)),[...expected,88,77],
   'Cancel keeps the accepted prefix but no old queued suffix survives a new connection epoch');
  assert.equal(output.some(data=>data.type==='error'||data.type==='fatal'),false);
 }finally{await worker.terminate();for(const entry of pending)clearTimeout(entry.timer);}
}
console.log('IrDA Worker: real ARM TX boundaries, eight queued packets consumed at one tick, ordered completion and full-window epoch cancellation pass.');
