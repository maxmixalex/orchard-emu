// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {CalculatorController} from '../web/controller.js';
import {MAX_FILE_BYTES,MAX_RECEIVE_FILES,MAX_LISTING_BYTES} from '../web/file-transfer.js';
import {CALCULATORS} from '../web/catalog.js';

function fixture(){
  const sent=[],downloads=[];
  const c=new CalculatorController({worker:{postMessage:d=>sent.push(d),terminate(){}},download:(bytes,name)=>downloads.push({bytes,name})});
  c.patch({model:CALCULATORS.find(m=>m.id===4),ready:true,loaded:true,running:false,serial:true,usb:true,usbReady:true});
  const emit=data=>c.receive({generation:c.generation,...data});
  return {c,sent,downloads,emit};
}
const file=(name='TEST',bytes=Uint8Array.from([...new TextEncoder().encode('HPHP49-C'),0,1,127,128,255]))=>({name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer});

// Resume after a file picker blur, then send one bounded, unchanged byte array.
for(const transport of ['usb','serial']){
 const {c,sent,emit}=fixture();await c.startTransfer('send',transport,{file:file()});
 assert.equal(sent.at(-2).type,'run');assert.equal(sent.at(-1).type,'file-transfer-start');
 assert.equal(sent.at(-1).transport,transport);
 assert.deepEqual([...sent.at(-1).bytes],[...new TextEncoder().encode('HPHP49-C'),0,1,127,128,255]);
 const request=c.transferRequest;assert.equal(sent.at(-1).request,request);
 emit({type:'file-transfer-status',request,active:true,phase:'sending',transferred:3,total:5});
 assert.equal(c.state.transfer.transferred,3);
 const n=sent.length;await c.startTransfer('receive','usb');assert.equal(sent.length,n);
 emit({type:'file-transfer-status',request,active:false,phase:'complete',transferred:5,total:5});
 assert.equal(c.state.transfer.active,false);c.dispose();
}
// Cancellation during asynchronous file reading must never start later.
for(const invalidate of ['cancel','generation','dispose']){
 const {c,sent}=fixture();let release;
 const waiting=c.startTransfer('send','usb',{file:{name:'TEST',size:1,arrayBuffer:()=>new Promise(r=>{release=r;})}});
 assert(c.state.transfer.active);
 if(invalidate==='cancel')c.cancelTransfer();else if(invalidate==='generation')c.create();else c.dispose();
 release(Uint8Array.of(42).buffer);await waiting;
 assert(!sent.some(m=>m.type==='file-transfer-start'),invalidate);c.dispose();
}
// Session IDs isolate late completions even within the same machine generation.
for(const transport of ['usb','serial'])for(const origin of ['user','worker']){
 const {c,sent,emit}=fixture();let release;const upload=file();
 upload.arrayBuffer=()=>new Promise(r=>{release=r;});
 const waiting=c.startTransfer('send',transport,{file:upload});
 if(origin==='user')c.connectLink(transport,false);
 else emit({type:transport==='usb'?'usb-status':'serial-status',connected:false,phase:'Disconnected'});
 release(await file().arrayBuffer());await waiting;
 assert(!sent.some(m=>m.type==='file-transfer-start'),`${transport} ${origin} disconnect`);
 assert.equal(c.state.transfer.active,false);assert.equal(c.state.transfer.phase,'cancelled');c.dispose();
}
for(const operation of ['pause','toggle','save','worker-error','fatal','stop']){
 const {c,sent,emit}=fixture();let release;const upload=file();
 upload.arrayBuffer=()=>new Promise(r=>{release=r;});
 c.patch({running:true});const waiting=c.startTransfer('send','usb',{file:upload});const request=c.transferRequest;
 if(operation==='worker-error')c.worker.onerror();
 else if(operation==='fatal')emit({type:'fatal',message:'Test worker failure'});
 else if(operation==='stop')emit({type:'snapshot',loaded:true,running:false,stopped:true});
 else c[operation]();
 release(await file().arrayBuffer());await waiting;
 emit({type:'file-transfer-received',request,name:'LATE',bytes:Uint8Array.of(1)});
 assert(!sent.some(m=>m.type==='file-transfer-start'),operation);
 assert.equal(c.state.transfer.active,false);assert.equal(c.received.size,0);c.dispose();
}
// A terminal result seals its request, even if a same-generation message is late.
for(const phase of ['error','cancelled','complete']){
 const {c,emit}=fixture();await c.startTransfer('receive','usb');const request=c.transferRequest;
 emit({type:'file-transfer-status',request,active:false,phase});
 emit({type:'file-transfer-received',request,name:'LATE',bytes:Uint8Array.of(1)});
 emit({type:'file-transfer-listing',request,text:'Late directory'});
 emit({type:'file-transfer-status',request,active:true,phase:'receiving'});
 assert.equal(c.received.size,0);assert.equal(c.state.transferListing,'');
 assert.equal(c.state.transfer.active,false);assert.equal(c.state.transfer.phase,phase);c.dispose();
}
{
 const {c,emit}=fixture();await c.startTransfer('receive','usb');const old=c.transferRequest;
 c.cancelTransfer();await c.startTransfer('receive','usb');const current=c.transferRequest;
 emit({type:'file-transfer-status',request:old,active:false,phase:'complete'});
 emit({type:'file-transfer-received',request:old,name:'OLD',bytes:Uint8Array.of(99)});
 assert.equal(c.state.transfer.request,current);assert(c.state.transfer.active);assert.equal(c.received.size,0);
 emit({type:'file-transfer-status',generation:c.generation-1,request:current,active:false,phase:'complete'});
 assert(c.state.transfer.active);c.dispose();
}
// No automatic download. Each explicit download keeps exact bytes; names cannot
// become host paths, and a reset invalidates every retained file identifier.
{
 const {c,emit,downloads}=fixture();await c.startTransfer('receive','usb');const request=c.transferRequest;
 const bytes=Uint8Array.of(0,255,13,10);
 emit({type:'file-transfer-received',request,name:'../folder\\TEST',bytes});bytes[0]=99;
 assert.equal(downloads.length,0);assert.equal(c.state.receivedFiles[0].name,'.._folder_TEST');
 const id=c.state.receivedFiles[0].id;c.downloadTransferredFile(id);await Promise.resolve();
 assert.deepEqual([...downloads[0].bytes],[0,255,13,10]);
 c.clearTransferredFiles();assert.equal(c.received.size,1);
 emit({type:'file-transfer-status',request,active:false,phase:'complete'});c.clearTransferredFiles();assert.equal(c.received.size,0);
 c.downloadTransferredFile(id);await Promise.resolve();assert.equal(downloads.length,1);
 await c.startTransfer('receive','usb');const next=c.transferRequest;
 emit({type:'file-transfer-received',request:next,name:'NEW',bytes:Uint8Array.of(2)});
 c.linksReset();assert.equal(c.received.size,0);assert.deepEqual(c.state.receivedFiles,[]);assert.equal(c.state.transfer,null);c.dispose();
}
// Unverified models reject uploads before reading local bytes on either link.
for(const [model,transport] of [[1,'serial'],[1,'usb']]){
 const {c,sent}=fixture();c.patch({model:CALCULATORS.find(m=>m.id===model)});let read=false;
 const upload={...file(),arrayBuffer:async()=>{read=true;return new ArrayBuffer(1);}};
 await c.startTransfer('send',transport,{file:upload});
 assert.equal(read,false);assert.equal(c.state.transfer.phase,'error');
 assert(!sent.some(m=>m.type==='file-transfer-start'));c.dispose();
}
// Serial enables only the proven server upload/GET pair. Other modes never
// post a Worker operation, and GET retains the real request/name/transport.
for(const mode of ['receive','directory','finish']){
 const {c,sent}=fixture();await c.startTransfer(mode,'serial');
 assert.equal(c.state.transfer.phase,'error');
 assert(!sent.some(m=>m.type==='file-transfer-start'));c.dispose();
}
{
 const {c,sent}=fixture();await c.startTransfer('get','serial',{name:'SERIAL'});
 assert.equal(sent.at(-1).type,'file-transfer-start');assert.equal(sent.at(-1).mode,'get');
 assert.equal(sent.at(-1).transport,'serial');assert.equal(sent.at(-1).name,'SERIAL');c.dispose();
}
// A raw serial disconnect must not cancel the independent USB transfer.
{
 const {c,emit}=fixture();await c.startTransfer('receive','usb');
 emit({type:'serial-status',connected:false});assert(c.state.transfer.active);c.dispose();
}
{
 const {c,emit}=fixture();await c.startTransfer('get','serial',{name:'SERIAL'});
 emit({type:'usb-status',connected:false,phase:'Disconnected'});assert(c.state.transfer.active);c.dispose();
}
// Reject size/name/connection errors before reading or posting file data.
for(const bad of [{...file(),size:MAX_FILE_BYTES+1},file('../TEST'),file('bad\nname'),file('中文')]){
 const {c,sent}=fixture();let read=false;bad.arrayBuffer=async()=>{read=true;return new ArrayBuffer(1);};
 await c.startTransfer('send','usb',{file:bad});assert.equal(read,false);assert.equal(c.state.transfer.phase,'error');
 assert(!sent.some(m=>m.type==='file-transfer-start'));c.dispose();
}
{
 const {c,sent}=fixture();c.patch({usbReady:false});await c.startTransfer('receive','usb');
 assert.equal(c.state.transfer.phase,'error');assert(!sent.some(m=>m.type==='file-transfer-start'));c.dispose();
}
// The browser's retained-file budget also applies across consecutive transfers.
{
 const {c,emit,sent}=fixture();await c.startTransfer('receive','usb');const request=c.transferRequest;
 for(let i=0;i<MAX_RECEIVE_FILES;i++)emit({type:'file-transfer-received',request,name:`F${i}`,bytes:Uint8Array.of(i)});
 emit({type:'file-transfer-received',request,name:'OVER',bytes:Uint8Array.of(1)});
 assert.equal(c.received.size,MAX_RECEIVE_FILES);assert.equal(c.state.transfer.phase,'error');
 assert.equal(sent.at(-1).type,'file-transfer-cancel');c.dispose();
}
// A directory must be complete: never silently display a truncated success.
for(const extra of [0,1]){
 const {c,sent,emit}=fixture();await c.startTransfer('receive','usb');const request=c.transferRequest;
 const text='X'.repeat(MAX_LISTING_BYTES+extra);
 emit({type:'file-transfer-listing',request,text});
 if(extra){
  emit({type:'file-transfer-status',request,active:false,phase:'complete'});
  assert.equal(c.state.transferListing,'');assert.equal(c.state.transfer.phase,'error');
  assert.equal(sent.at(-1).type,'file-transfer-cancel');
 }else assert.equal(c.state.transferListing,text);
 c.dispose();
}
console.log('File transfer controller: exact bytes, explicit downloads, bounded files/directories, stale generations/requests, picker cancellation and reset isolation pass.');
