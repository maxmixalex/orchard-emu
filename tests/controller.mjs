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
