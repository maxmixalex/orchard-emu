// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {CalculatorController} from '../web/controller.js';
import {AUTO_PREFIX,DEFAULTS,writeAuto} from '../web/preferences.js';
const memory=new Map();const storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k),get length(){return memory.size;},key:i=>[...memory.keys()][i]};
const sent=[],downloaded=[];const worker={postMessage:d=>sent.push(d),terminate(){this.terminated=true;}};
const c=new CalculatorController({worker,storage,download:(data,name)=>downloaded.push({data,name}),now:()=>new Date(2026,9,9,12,34,56)});
let renders=0,frames=0;c.subscribe(()=>renders++);c.onFrame(()=>frames++);
worker.onmessage({data:{type:'ready'}});assert.equal(c.generation,1);assert.equal(sent[0].type,'create');
worker.onmessage({data:{type:'created',generation:1}});assert.equal(c.state.busy,false);
const pixels=new Uint8Array(8384);const snapshot={type:'snapshot',generation:1,loaded:true,running:true,stopped:false,width:131,height:64,pixels,active:null};
c.receive(snapshot);const count=renders;for(let i=0;i<20;i++)c.receive({...snapshot,pixels:pixels.slice()});assert.equal(renders,count);assert.equal(frames,21);
c.receive({...snapshot,generation:0,running:false});assert.equal(c.state.running,true);
c.tap([58,28]);assert.deepEqual(sent.at(-1).scans,[58,28]);c.patch({busy:true});const n=sent.length;c.tap([26]);assert.equal(sent.length,n);c.patch({busy:false});
const p=c.ask('restart','clearMemory','restart','cancel');const p2=c.ask('error','operationFailed');c.answer(false);assert.equal(await p,false);assert.equal(c.state.dialog.title,'error');c.answer(null);assert.equal(await p2,null);
c.save();assert.equal(sent.at(-1).type,'checkpoint-save');c.receive({type:'checkpoint-saved',generation:1,file:new Uint8Array([1])});assert.equal(downloaded[0].name,'hp39gplus-20261009-123456.ord');
c.setPreferences({...DEFAULTS,mappings:{},autosave:true,pauseOnHidden:false});assert.equal(c.state.prefs.autosave,true);assert.equal(sent.at(-1).type,'configure');
c.requestAuto();const req=c.autoPending;assert(req);c.receive({type:'checkpoint-skipped',generation:1,request:999});assert.equal(c.autoPending,req);
c.receive({type:'checkpoint-auto-saved',generation:1,request:req.request,file:new Uint8Array([1,2])});await new Promise(r=>setTimeout(r,0));assert(memory.has(AUTO_PREFIX+c.state.model.hash));
c.foreignSave(AUTO_PREFIX+c.state.model.hash);assert(c.autoBlocked);assert.equal(c.state.note,'foreignSave');
// Recreate invalidates old auto completions and frame state.
c.create();c.receive({type:'checkpoint-auto-saved',generation:1,request:req.request,file:new Uint8Array([3])});assert.equal(c.last,null);
// Dismiss restore must not overwrite the old save or automatically Run.
c.patch({loaded:true});const loading=c.loadedROM();assert.equal(c.state.dialog.title,'restoreLocal');c.answer(null);await loading;assert(c.autoBlocked);assert.equal(c.state.note,'localKept');
const pending=c.ask('error','operationFailed');c.dispose();assert.equal(await pending,null);assert(worker.terminated);const old=c.state;c.receive(snapshot);assert.equal(c.state,old);
// A successful restore resumes under the current focus/visibility policy.
// Saved compatibility stops stay stopped and stale-generation replies do nothing.
for(const allowed of [true,false])for(const stopped of [true,false]){
 const posts=[];const q=new CalculatorController({worker:{postMessage:d=>posts.push(d),terminate(){}},database:null,mayRun:()=>allowed});
 q.patch({loaded:true,busy:true});q.receive({type:'checkpoint-restored',generation:q.generation,stopped});
 assert.equal(posts.some(d=>d.type==='run'),allowed&&!stopped);assert.equal(q.state.stopped,stopped);assert.equal(q.state.busy,false);
 const n=posts.length;q.receive({type:'checkpoint-restored',generation:q.generation+1,stopped:false});assert.equal(posts.length,n);q.dispose();
}
// Disconnect before changing the machine generation: stale link notifications
// must not leave the new calculator marked active or suppress its focus policy.
for(const action of ['create','pause','worker-error','fatal','error','links-reset']){
 const w={postMessage(){},terminate(){}};
 const q=new CalculatorController({worker:w,database:null});q.patch({loaded:true,running:true});
 q.connectIrDA('CTRL23');assert.equal(q.state.irda.active,true);
 if(action==='create')q.create();
 else if(action==='pause')q.send('pause');
 else if(action==='worker-error')w.onerror();
 else q.receive({type:action,generation:q.generation,message:'Fixture failure'});
 assert.equal(q.irdaLink,null,action);assert.equal(q.state.irda.active,false,action);q.dispose();
}
// A peer replacement is its own epoch even without a calculator reset. Exercise
// both pending Worker replies and the gap between partial acceptance retries.
{
 const NativeChannel=globalThis.BroadcastChannel,nativeTimeout=globalThis.setTimeout,nativeClear=globalThis.clearTimeout;
 const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
 const channels=[],delays=[],deadlines=new Set();
 globalThis.BroadcastChannel=class{
  constructor(){this.messages=[];channels.push(this);}
  postMessage(message){this.messages.push(structuredClone(message));}
  close(){this.closed=true;}
 };
 globalThis.setTimeout=(fn,ms,...args)=>{
  if(ms===5){delays.push(()=>fn(...args));return 0;}
  if(ms===2000){const timer={run:()=>fn(...args),active:true};deadlines.add(timer);return timer;}
  return nativeTimeout(fn,ms,...args);
 };
 globalThis.clearTimeout=timer=>{if(deadlines.has(timer)){timer.active=false;deadlines.delete(timer);}else nativeClear(timer);};
 try{
  // A coalesced packet can need several bounded Worker staging attempts.
  // The channel ACK follows the final suffix, never an intermediate prefix.
  {
   const payload=Uint8Array.from({length:1024},(_,i)=>i&255),received=[],lengths=[],capacity=[0,127,0,384,513];
   const q=new CalculatorController({worker:{postMessage(message){
    if(message.type!=='irda-input')return;
    lengths.push(message.bytes.length);const accepted=capacity.shift();assert.notEqual(accepted,undefined);
    assert.equal(channels.at(-1).messages.filter(value=>value.kind==='ack').length,0);
    received.push(...message.bytes.subarray(0,accepted));
    queueMicrotask(()=>q.receive({type:'irda-input-result',generation:q.generation,epoch:message.epoch,request:message.request,accepted,discarded:false}));
   },terminate(){}},database:null});
   q.patch({loaded:true,running:true});q.connectIrDA('EPOCH23');
   const link=q.irdaLink,channel=channels.at(-1);
   link.message({version:2,kind:'hello',from:'partial-peer',label:'partial'});
   link.message({version:2,kind:'bytes',from:'partial-peer',sequence:1,bytes:payload,segments:[[payload.length,0]]});
   await settle();
   while(delays.length){assert.equal(delays.length,1);delays.shift()();await settle();}
   assert.deepEqual(received,Array.from(payload));assert.deepEqual(lengths,[1024,1024,897,897,513]);
   assert.equal(channel.messages.filter(message=>message.kind==='ack').length,1);
   assert.equal(link.received,1024);assert.equal(q.irdaInput.size,0);q.dispose();
  }
  {
   const posts=[],q=new CalculatorController({worker:{postMessage:message=>posts.push(message),terminate(){}},database:null});
   q.patch({loaded:true,running:true});q.connectIrDA('EPOCH23');const link=q.irdaLink,channel=channels.at(-1);
   link.message({version:2,kind:'hello',from:'timed-peer',label:'timed'});
   link.message({version:2,kind:'bytes',from:'timed-peer',sequence:1,bytes:Uint8Array.of(1,2,3),segments:[[1,10],[1,1000],[1,2000]]});await settle();
   const request=posts.find(message=>message.type==='irda-input').request,first=[...deadlines].at(-1);
   q.receive({type:'irda-input-progress',generation:q.generation,epoch:q.irdaEpoch,request,tick:500});
   const renewed=[...deadlines].at(-1);assert.notEqual(renewed,first);assert.equal(first.active,false);
   assert.equal(channel.messages.filter(message=>message.kind==='progress').length,1);
   q.receive({type:'irda-input-progress',generation:q.generation,epoch:q.irdaEpoch,request,tick:500});
   assert.equal([...deadlines].at(-1),renewed,'Only increasing actual guest time renews a Worker deadline');
   q.receive({type:'irda-input-result',generation:q.generation,epoch:q.irdaEpoch,request,accepted:2,discarded:true});await settle();
   assert.equal(link.received,2,'Delivered prefix and suffix count even if the intervening arriving segment was discarded');
   assert.equal(channel.messages.filter(message=>message.kind==='ack').length,1);assert.equal(renewed.active,false);
   assert.equal(posts.filter(message=>message.type==='irda-input').length,1,'A consumed mixed-delivery packet is never retried');q.dispose();
  }
  for(const pauseAt of ['worker-reply','backpressure']){
  const posts=[],q=new CalculatorController({worker:{postMessage:message=>posts.push(message),terminate(){}},database:null});
  q.patch({loaded:true,running:true});q.connectIrDA('EPOCH23');
  const old=q.irdaLink,oldChannel=channels.at(-1),generation=q.generation,epoch=q.irdaEpoch;
  old.message({version:2,kind:'hello',from:'old-peer',label:'old'});
  old.message({version:2,kind:'bytes',from:'old-peer',sequence:1,bytes:Uint8Array.of(1,2,3,4),segments:[[4,0]]});
  await settle();const first=posts.find(message=>message.type==='irda-input');assert(first);
  if(pauseAt==='backpressure'){
   q.receive({type:'irda-input-result',generation,epoch,request:first.request,accepted:1,discarded:false});
   await settle();assert.equal(delays.length,1);
  }
  q.disconnectIrDA();q.connectIrDA('EPOCH23');
  const current=q.irdaLink,currentChannel=channels.at(-1);
  current.message({version:2,kind:'hello',from:'new-peer',label:'new'});
  assert.equal(q.generation,generation);assert.notEqual(current,old);
  q.receive({type:'irda-output',generation,epoch,tick:100,bytes:Uint8Array.of(90)});
  assert.equal(currentChannel.messages.filter(message=>message.kind==='bytes').length,0,'A queued old Worker output cannot enter the new peer');
  q.receive({type:'irda-output',generation,epoch:q.irdaEpoch,tick:100,bytes:Uint8Array.of(91)});
  assert.deepEqual(Array.from(currentChannel.messages.find(message=>message.kind==='bytes').bytes),[91]);
  if(pauseAt==='backpressure')delays.shift()();
  await settle();
  assert.equal(posts.filter(message=>message.type==='irda-input').length,1,'No old suffix enters the new peer');
  assert.equal(oldChannel.messages.filter(message=>message.kind==='ack').length,0,'Closed receive cannot ACK its old peer');
  assert(current.active);assert.equal(current.phase,'paired','Old rejection cannot close the new link');
  current.message({version:2,kind:'bytes',from:'new-peer',sequence:1,bytes:Uint8Array.of(7,8),segments:[[2,0]]});
  await settle();const next=posts.filter(message=>message.type==='irda-input').at(-1);
  assert.notEqual(next.request,first.request);assert.deepEqual(Array.from(next.bytes),[7,8]);
  q.receive({type:'irda-input-result',generation,epoch,request:first.request,accepted:4,discarded:false});
  q.receive({type:'irda-input-progress',generation,epoch,request:next.request,tick:999});
  await settle();assert.equal(currentChannel.messages.filter(message=>message.kind==='ack').length,0,'Late old Worker result cannot ACK new bytes');
  assert.equal(currentChannel.messages.filter(message=>message.kind==='progress').length,0,'Old epoch progress cannot extend a new request');
  q.receive({type:'irda-input-result',generation,epoch:q.irdaEpoch,request:next.request,accepted:2,discarded:false});
  await settle();assert.equal(currentChannel.messages.filter(message=>message.kind==='ack').length,1);
  assert.equal(current.received,2);assert(current.active);assert.equal(q.irdaInput.size,0);q.dispose();
 }}finally{globalThis.BroadcastChannel=NativeChannel;globalThis.setTimeout=nativeTimeout;globalThis.clearTimeout=nativeClear;}
}
// A storage operation can already be awaiting IndexedDB when its session is
// replaced. Both success and rejection belong to the original request only.
for(const end of ['success','error'])for(const invalidate of ['create','disable','foreign','dispose']){
 const q=new CalculatorController({worker:{postMessage(){},terminate(){}},storage,database:null});
 q.patch({loaded:true,prefs:{...q.state.prefs,autosave:true}});
 let resolveWrite,rejectWrite;
 q.autoStore={write:()=>new Promise((resolve,reject)=>{resolveWrite=resolve;rejectWrite=reject;})};
 q.requestAuto();const request=q.autoPending.request;
 const saving=q.acceptAuto({request,file:Uint8Array.of(1,2,3)});assert(resolveWrite);
 if(invalidate==='create')q.create();
 else if(invalidate==='disable')q.setPreferences({...q.state.prefs,autosave:false});
 else if(invalidate==='foreign')q.foreignSave(AUTO_PREFIX+q.state.model.hash);
 else q.dispose();
 const note=q.state.note,blocked=q.autoBlocked,token=q.autoToken;
 if(end==='error')rejectWrite(new Error('Deferred storage failure'));else resolveWrite('old-writer');
 await saving;
 assert.equal(q.autoBlocked,blocked,`${invalidate}: stale ${end} changed autoBlocked`);
 assert.equal(q.autoToken,token,`${invalidate}: stale ${end} changed token`);
 assert.equal(q.state.note,note,`${invalidate}: stale ${end} changed note`);
 assert.equal(q.state.dialog,null,`${invalidate}: stale ${end} opened an error dialog`);
 assert.equal(q.autoPending,null);q.dispose();
}
{
 const q=new CalculatorController({worker:{postMessage(){},terminate(){}},storage,database:null});
 q.patch({loaded:true,prefs:{...q.state.prefs,autosave:true}});
 q.autoStore={write:async()=>{throw new Error('Current storage failure');}};
 q.requestAuto();await q.acceptAuto({request:q.autoPending.request,file:Uint8Array.of(1)});
 assert(q.autoBlocked);assert.equal(q.state.note,'autoStopped');
 assert.equal(q.state.dialog.message,'storageError');assert.equal(q.state.dialog.values.detail,'Current storage failure');q.dispose();
}
console.log('Controller: stale generations, ordered modals, independent frame subscriptions, physical macros, session filenames, autosave conflict/dismissal, deferred storage success/rejection isolation and disposal pass.');
