// SPDX-License-Identifier: MIT
// Production Worker + real WASM + generated ARM instructions. No ROM fixture,
// simulated UART queue, or injected Worker output is used in this regression.
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';

const adapter=`
import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
globalThis.self=globalThis;
globalThis.postMessage=data=>parentPort.postMessage(data);
globalThis.fetch=async url=>{
  if(String(url)!==new URL('orchard.wasm',workerData.workerURL).href)throw Error('Unexpected asset request');
  return new Response(await readFile(new URL(workerData.wasmURL)),{status:200});
};
parentPort.on('message',data=>self.onmessage?.({data}));
await import(workerData.workerURL);
`;
function guest(mode){
  const words=[0xea000000,0xeafffffe],literals=[];
  const ldr=(reg,value)=>{literals.push({index:words.length,reg,value});words.push(0);};
  ldr(0,0x53000000);words.push(0xe3a01000,0xe5801000); // Watchdog off.
  ldr(0,0x50008000);words.push(0xe3a01043,0xe5801000); // UART2, 8-bit IR.
  words.push(mode==='loopback'?0xe3a01025:mode==='disabled'?0xe3a01000:0xe3a01005,0xe5801004);
  words.push(0xe3a01042,0xe5c01020); // Transmit B through the actual UTXH register.
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
  const send=data=>worker.postMessage({generation:1,...data});
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
console.log('IrDA Worker: real ARM send→disable and send→mode-change retain transmitted bytes; internal loopback, unpaired output and disabled TX do not forward.');
