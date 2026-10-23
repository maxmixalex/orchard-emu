// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {ROMAccessError,readRememberedROM,romRecordInfo} from '../web/rom-storage.js';
import {CalculatorController} from '../web/controller.js';
import {CALCULATORS} from '../web/catalog.js';
const model=CALCULATORS[0],bytes=new Uint8Array(model.bytes);bytes[0]=31;bytes[bytes.length-1]=97;
const file=new File([bytes],'original.any-extension');
const base={version:1,model:model.id,hash:model.hash,name:file.name,savedAt:1000};
const copy={...base,kind:'copy',file};
assert.deepEqual(new Uint8Array(await (await readRememberedROM(copy)).arrayBuffer()),bytes);
assert(!('file' in romRecordInfo(copy)));
let permission='prompt',reads=0,requests=0;
const handle={kind:'file',queryPermission:async()=>permission,
  requestPermission:async options=>{assert.deepEqual(options,{mode:'read'});++requests;return permission='granted';},
  getFile:async()=>{++reads;return file;}};
const reference={...base,kind:'handle',handle};
await assert.rejects(readRememberedROM(reference),e=>e instanceof ROMAccessError&&e.code==='permission');
assert.equal(requests,0,'Startup must never prompt for file permission');assert.equal(reads,0);
assert.equal(await readRememberedROM(reference,{request:true}),file);assert.equal(requests,1);assert.equal(reads,1);
assert.equal(await readRememberedROM(reference),file);assert.equal(requests,1);
handle.getFile=async()=>{throw new DOMException('moved','NotFoundError');};
await assert.rejects(readRememberedROM(reference),e=>e.code==='missing');
handle.getFile=async()=>file;
await assert.rejects(readRememberedROM({...copy,hash:'f'.repeat(64)}),e=>e.code==='storage');

const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function fixture(store){
  const messages=[],opened=[],storage={getItem:()=>null,setItem(){}},c=new CalculatorController({worker:{postMessage:m=>messages.push(m),terminate(){}},storage,database:null,romStore:store});
  // This spy observes routing only. Actual ROM hashing/loading and browser
  // reload are checked by the separate original-ROM browser witness.
  c.open=async(f,options)=>{opened.push({f,options});return true;};
  return {c,messages,opened};
}
{
  const {c,opened}=fixture({list:async()=>({records:[reference],last:reference})});
  c.receive({type:'ready'});await settle();
  assert.equal(opened.length,1);assert.equal(opened[0].options.automatic,true);
  assert.equal(opened[0].options.expectedHash,model.hash);assert.equal(opened[0].options.handle,handle);
  assert.equal(c.state.rememberedROMs[0].kind,'handle');c.dispose();
}
{
  let resolve;
  const {c,opened}=fixture({list:()=>new Promise(r=>resolve=r)});
  c.receive({type:'ready'});c.select(5);resolve({records:[copy],last:copy});await settle();
  assert.equal(opened.length,0,'A startup read must not replace a newer model selection');
  assert.equal(c.state.model.id,5);c.dispose();
}
{
  const {c,opened}=fixture({list:async()=>({records:[copy],last:copy})});
  c.patch({prefs:{...c.state.prefs,rememberROM:false}});c.receive({type:'ready'});await settle();
  assert.equal(opened.length,0);assert.equal(c.state.rememberedROMs.length,1,'Disabled automatic reading retains explicit recent-file choices');c.dispose();
}
{
  permission='prompt';requests=0;
  const {c,opened}=fixture({list:async()=>({records:[reference],last:reference}),clear:async()=>{}});
  c.receive({type:'ready'});await settle();
  assert.equal(requests,0);assert.equal(opened.length,0);assert.equal(c.state.romIssue.code,'permission');
  await c.openRememberedROM(model.id);assert.equal(opened.length,1);assert.equal(requests,1);
  let finish;handle.getFile=()=>new Promise(r=>finish=r);
  const pending=c.openRememberedROM(model.id);await settle();await c.forgetROMs();finish(file);await pending;
  assert.equal(opened.length,1,'Forgetting while getFile is pending must cancel that read');assert.equal(c.romRecords.size,0);c.dispose();
}
{
  const {c}=fixture({remember:async()=>{throw Error('quota');}});
  c.patch({loaded:true});c.currentROM={model,file,handle:null};await c.rememberCurrentROM();
  assert.equal(c.state.loaded,true);assert.equal(c.state.dialog,null);assert.equal(c.state.romIssue.code,'storage');c.dispose();
}
{
  let finish;permission='granted';handle.getFile=()=>new Promise(r=>finish=r);
  const {c,opened}=fixture(null);c.patch({ready:true});c.romRecords.set(model.id,reference);
  const pending=c.openRememberedROM(model.id,{automatic:true});await settle();
  c.setPreferences({...c.state.prefs,rememberROM:false});
  // Re-enabling must not revive the already cancelled automatic operation.
  c.setPreferences({...c.state.prefs,rememberROM:true});finish(file);await pending;
  assert.equal(opened.length,0);assert.equal(c.state.romIssue,null);
  const explicit=c.openRememberedROM(model.id);await settle();
  c.setPreferences({...c.state.prefs,rememberROM:false});finish(file);await explicit;
  assert.equal(opened.length,1,'Explicit Open remains authorized when automatic recall is disabled');c.dispose();
}
{
  // Use the production open implementation, cancelling while file bytes are
  // pending. Cancellation must precede hashing/ROM admission and clear busy.
  let finish;const messages=[];
  const c=new CalculatorController({worker:{postMessage:m=>messages.push(m),terminate(){}},storage:{getItem:()=>null,setItem(){}},database:null});
  c.patch({ready:true});
  const pending=c.open({size:model.bytes,name:'delayed.bin',arrayBuffer:()=>new Promise(r=>finish=r)},{automatic:true});
  await settle();assert.equal(c.state.busy,true);
  c.setPreferences({...c.state.prefs,rememberROM:false});finish(new ArrayBuffer(model.bytes));await pending;
  assert.equal(c.state.busy,false);assert.equal(c.state.loaded,false);assert.equal(c.state.dialog,null);
  assert(!messages.some(m=>m.type==='create'));c.dispose();
}
console.log('Remembered ROM: handle versus copy identity, read-only permission, no startup prompt, missing file, model switching, disabled auto-open, pending-read cancellation, explicit Open independence and nonblocking storage failure pass.');
