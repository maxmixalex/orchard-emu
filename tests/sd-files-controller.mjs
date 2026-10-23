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
const editing=fixture(),ec=editing.controller,association={name:'local',handle:{kind:'directory'}};
await ec.insertSD(file,false,association);
ec.receive({type:'sd-complete',action:'insert',generation:ec.generation,name:'linked.img'});
ec.patch({sd:{present:true,bytes:original.length,dirty:true,writeProtected:true}});
check(()=>assert.equal(ec.sdDirectory,association));
const edit=ec.editSD();check(()=>assert.equal(editing.messages.at(-1).type,'sd-edit'));check(()=>assert.equal(ec.state.busy,true));
check(()=>assert.equal(ec.state.sd.present,true));
ec.receive({type:'sd-edited',generation:ec.generation,bytes:original});
const draft=await edit;
check(()=>assert.equal(draft.bytes,original));check(()=>assert.equal(draft.name,'linked.img'));check(()=>assert.equal(draft.association,association));
check(()=>assert.equal(draft.writeProtected,true));check(()=>assert.equal(ec.state.sd,null));check(()=>assert.equal(ec.state.busy,false));
ec.patch({sd:{present:true,bytes:original.length}});
const rejectedEdit=ec.editSD();ec.receive({type:'sd-error',generation:ec.generation,message:'Unsupported FAT16 image'});
assert.equal(await rejectedEdit,null);checks++;check(()=>assert.equal(ec.state.sd.present,true));ec.answer(true);
const cancelledEdit=ec.editSD();ec.create(CALCULATORS.find(model=>model.id===6));
assert.equal(await cancelledEdit,null);checks++;check(()=>assert.equal(ec.sdDirectory,null));ec.dispose();
const lost=fixture();lost.controller.patch({sd:{present:true,bytes:original.length}});
const lostEdit=lost.controller.editSD();lost.worker.onerror();assert.equal(await lostEdit,null);checks++;lost.controller.dispose();
const closed=fixture();closed.controller.patch({sd:{present:true,bytes:original.length}});
const closedEdit=closed.controller.editSD();closed.controller.dispose();assert.equal(await closedEdit,null);checks++;
const restored=fixture();restored.controller.sdDirectory=association;
restored.controller.receive({type:'checkpoint-restored',generation:restored.controller.generation});
check(()=>assert.equal(restored.controller.sdDirectory,null));restored.controller.dispose();

// A local-device connection owns the live machine during both handshake and
// attachment. Do not even read an insertion source or ask to discard dirty
// media; the same actions become available again after disconnecting.
for(const phase of ['connecting','attached']){
  const linked=fixture(),lc=linked.controller;let read=false;
  lc.patch({hostBridge:{active:true,phase},sd:{present:true,dirty:true,bytes:original.length}});
  lc.exportSD();check(()=>assert.equal(lc.state.dialog.message,'sdHostBridgeBusy'));lc.answer(true);
  check(()=>assert.equal(lc.state.busy,false));
  check(()=>assert.equal(lc.sdEditPending,null));
  assert.equal(await lc.editSD(),null);checks++;
  check(()=>assert.equal(lc.state.dialog.message,'sdHostBridgeBusy'));lc.answer(true);
  await lc.ejectSD();check(()=>assert.equal(lc.state.dialog.message,'sdHostBridgeBusy'));lc.answer(true);
  check(()=>assert.equal(lc.state.sd.present,true));
  lc.patch({sd:null});
  await lc.insertSD({name:'linked.img',size:original.length,arrayBuffer:async()=>{read=true;return original.buffer;}},false,association);
  check(()=>assert.equal(read,false));check(()=>assert.equal(lc.sdInsertDirectory,null));
  check(()=>assert.equal(lc.state.busy,false));check(()=>assert.equal(linked.messages.length,0));
  check(()=>assert.equal(lc.state.dialog.message,'sdHostBridgeBusy'));lc.answer(true);lc.dispose();
}

const lateBridge=fixture(),bc=lateBridge.controller;let finishRead;
const lateInsert=bc.insertSD({name:'late.img',size:original.length,arrayBuffer:()=>new Promise(resolve=>{finishRead=resolve;})},false,association);
bc.patch({hostBridge:{active:true,phase:'attached'}});finishRead(original.buffer.slice(0));await lateInsert;
check(()=>assert.equal(lateBridge.messages.length,0));check(()=>assert.equal(bc.state.busy,false));
check(()=>assert.equal(bc.sdInsertDirectory,null));check(()=>assert.equal(bc.state.dialog.message,'sdHostBridgeBusy'));bc.answer(true);
bc.patch({hostBridge:{active:false},sd:{present:true,dirty:true,bytes:original.length}});
const lateEject=bc.ejectSD();check(()=>assert.equal(bc.state.dialog.message,'sdEjectConfirm'));
bc.patch({hostBridge:{active:true,phase:'connecting'}});bc.answer(true);await lateEject;
check(()=>assert.equal(lateBridge.messages.length,0));check(()=>assert.equal(bc.state.sd.present,true));
check(()=>assert.equal(bc.state.busy,false));check(()=>assert.equal(bc.state.dialog.message,'sdHostBridgeBusy'));bc.answer(true);
bc.patch({hostBridge:{active:false}});bc.sdDirectory=association;
const racedEdit=bc.editSD();bc.receive({type:'sd-error',generation:bc.generation,code:'hostBridgeBusy',message:'untranslated transport detail'});
assert.equal(await racedEdit,null);checks++;
check(()=>assert.equal(bc.state.busy,false));check(()=>assert.equal(bc.state.sd.present,true));
check(()=>assert.equal(bc.sdDirectory,association));check(()=>assert.equal(bc.sdEditPending,null));
check(()=>assert.equal(bc.state.dialog.message,'sdHostBridgeBusy'));check(()=>assert.equal(bc.state.dialog.values.detail,''));bc.answer(true);
const retryEdit=bc.editSD();bc.receive({type:'sd-edited',generation:bc.generation,bytes:original});
const retryDraft=await retryEdit;check(()=>assert.equal(retryDraft.bytes,original));check(()=>assert.equal(retryDraft.association,association));bc.dispose();
console.log(`SD controller: ${checks} ownership, failure retry, generation/disposal cancellation, atomic edit handoff, directory association, local-device exclusion and no-slot checks pass.`);
