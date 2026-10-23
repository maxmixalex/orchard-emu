// SPDX-License-Identifier: MIT
// Production controller ownership/cancellation boundary. Worker messages use a
// structured clone; stock media behavior is verified by the separate SD gate.
import assert from 'node:assert/strict';
import {CalculatorController} from '../web/controller.js';
import {CALCULATORS} from '../web/catalog.js';
import {createSDImage} from '../web/sd-card.js';
import {addSDFiles} from '../web/sd-filesystem.js';
let checks=0;
const check=operation=>{operation();++checks;};
function fixture(model=5){
  const messages=[],worker={postMessage:data=>messages.push(structuredClone(data)),terminate(){this.terminated=true;}};
  const controller=new CalculatorController({worker,database:null});
  controller.patch({model:CALCULATORS.find(item=>item.id===model),loaded:true,ready:true,prefs:{...controller.state.prefs,autosave:false}});
  return {controller,worker,messages,inserts:()=>messages.filter(message=>message.type==='sd-insert')};
}
const original=addSDFiles(createSDImage(),'/',[{name:'ARBITRY',bytes:new Uint8Array([0,255,13,10])}]);
const source=new Uint8Array(original),file=new File([source],'source.unusual');
source[100000]^=0xff; // File must own the snapshot taken by its constructor.
const sourceSnapshot=new Uint8Array(source);
const one=fixture(),c=one.controller;
await c.insertSD(file,true);
check(()=>assert.equal(one.inserts().length,1));
check(()=>assert.deepEqual(one.inserts()[0].bytes,original));
check(()=>assert.equal(one.inserts()[0].writeProtected,true));
check(()=>assert.equal(one.inserts()[0].name,'source.unusual.img'));
check(()=>assert.equal(c.state.busy,true));
await c.insertSD(file,false);check(()=>assert.equal(one.inserts().length,1));
one.inserts()[0].bytes[200000]^=0xff;
check(()=>assert.deepEqual(source,sourceSnapshot));
check(()=>assert.notEqual(one.inserts()[0].bytes.buffer,source.buffer));
const fileBytes=new Uint8Array(await file.arrayBuffer());
check(()=>assert.deepEqual(fileBytes,original));

// A rejected Worker insertion reopens the same operation without changing the
// source File; an acknowledgement from another generation has no authority.
c.receive({type:'sd-error',generation:c.generation-1,message:'stale'});
check(()=>assert.equal(c.state.busy,true));
c.receive({type:'sd-error',generation:c.generation,message:'allocation failed'});
check(()=>assert.equal(c.state.busy,false));
check(()=>assert.equal(c.state.dialog.message,'sdError'));
check(()=>assert.equal(c.state.sd,null));
c.answer(true);await c.insertSD(file,true);
check(()=>assert.equal(one.inserts().length,2));
check(()=>assert.deepEqual(one.inserts()[1].bytes,original));
c.dispose();

const failed=fixture();
await failed.controller.insertSD({name:'unreadable',size:original.length,arrayBuffer:async()=>{throw Error('read failed');}},false);
check(()=>assert.equal(failed.inserts().length,0));
check(()=>assert.equal(failed.controller.state.busy,false));
check(()=>assert.equal(failed.controller.state.dialog.message,'sdError'));
failed.controller.dispose();

const switched=fixture();let resolveRead;
const loading=switched.controller.insertSD({name:'late',size:original.length,arrayBuffer:()=>new Promise(resolve=>{resolveRead=resolve;})},false);
const oldGeneration=switched.controller.generation;
switched.controller.create(CALCULATORS.find(model=>model.id===6));
resolveRead(original.buffer.slice(0));await loading;
check(()=>assert.equal(switched.inserts().length,0));
check(()=>assert.equal(switched.controller.state.busy,false));
check(()=>assert.equal(switched.controller.state.sd,null));
switched.controller.receive({type:'sd-complete',generation:oldGeneration,action:'insert',name:'late.img'});
check(()=>assert.equal(switched.controller.state.sdName,'orchard-sd.img'));
check(()=>assert.equal(switched.controller.state.dialog,null));
switched.controller.dispose();

const disposed=fixture();let resolveDisposed;
const pending=disposed.controller.insertSD({name:'late',size:original.length,arrayBuffer:()=>new Promise(resolve=>{resolveDisposed=resolve;})},false);
disposed.controller.dispose();resolveDisposed(original.buffer.slice(0));await pending;
check(()=>assert.equal(disposed.inserts().length,0));
check(()=>assert.equal(disposed.worker.terminated,true));
const noSlot=fixture(4);let read=false;
await noSlot.controller.insertSD({name:'no slot',size:original.length,arrayBuffer:async()=>{read=true;return original.buffer;}},false);
check(()=>assert.equal(read,false));check(()=>assert.equal(noSlot.inserts().length,0));noSlot.controller.dispose();
console.log(`SD controller: ${checks} ownership, read-only, failed-insertion retry, file-read failure, generation/disposal cancellation and no-slot checks pass.`);
