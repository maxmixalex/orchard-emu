// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {CalculatorController} from '../web/controller.js';
import {MAX_FILE_BYTES,MAX_UPLOAD_FILES,MAX_UPLOAD_BYTES,MAX_RECEIVE_FILES,MAX_LISTING_BYTES} from '../web/file-transfer.js';
import {CALCULATORS} from '../web/catalog.js';

function fixture(){
  const sent=[],downloads=[];
  const c=new CalculatorController({worker:{postMessage:d=>sent.push(d),terminate(){}},download:(bytes,name)=>downloads.push({bytes,name})});
  c.patch({model:CALCULATORS.find(m=>m.id===4),ready:true,loaded:true,running:false,serial:true,usb:true,usbReady:true});
  const emit=data=>c.receive({generation:c.generation,...data});
  return {c,sent,downloads,emit};
}
const file=(name='TEST',bytes=Uint8Array.from([...new TextEncoder().encode('HPHP49-C'),0,1,127,128,255]))=>({name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer});

// A synchronous Worker post failure must seal the new Wire request without
// discarding its bytes or leaving the entire queue active and unusable.
{
 const {c,sent,emit}=fixture();c.patch({model:CALCULATORS.find(m=>m.id===1)});
 const original=c.worker.postMessage;let failed=false;
 c.worker.postMessage=data=>{
   if(data.type==='file-transfer-start'&&!failed){failed=true;throw Error('Test Worker post failure');}
   original(data);
 };
 const bytes=new TextEncoder().encode('HP39BinH\x03Lib\x00\x01');
 await c.startHp39Server('usb',[{file:file('LIB.arbitrary',bytes)}],{protocol:'wire'});
 assert.equal(c.state.transfer.active,false);assert.equal(c.state.transfer.phase,'error');
 assert.equal(c.state.uploadBatch.active,false);assert.equal(c.state.uploadBatch.recoverable,true);
 assert.equal(c.state.transfer.error,'Test Worker post failure');assert.deepEqual(c.uploadQueue.entries[0].bytes,bytes);
 const old=c.transferRequest;await c.retryUploadFile();
 assert(c.transferRequest>old);assert.equal(sent.at(-1).type,'file-transfer-start');
 assert.deepEqual(sent.at(-1).bytes,bytes);
 emit({type:'file-transfer-status',request:c.transferRequest,active:false,phase:'complete',transferred:bytes.length,total:bytes.length});
 assert.equal(c.state.uploadBatch.completed,1);assert.equal(c.uploadQueue,null);c.dispose();
}

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
for(const [model,transport] of [[6,'serial'],[6,'usb']]){
 const {c,sent}=fixture();c.patch({model:{id:model}});let read=false;
 const upload={...file(),arrayBuffer:async()=>{read=true;return new ArrayBuffer(1);}};
 await c.startTransfer('send',transport,{file:upload});
 assert.equal(read,false);assert.equal(c.state.transfer.phase,'error');
 assert(!sent.some(m=>m.type==='file-transfer-start'));c.dispose();
}
// Each admitted serial operation retains the real request/mode/transport.
for(const mode of ['receive','directory','finish']){
 const {c,sent}=fixture();await c.startTransfer(mode,'serial');
 assert.equal(sent.at(-1).type,'file-transfer-start');assert.equal(sent.at(-1).mode,mode);
 assert.equal(sent.at(-1).transport,'serial');assert.equal(c.state.transfer.active,true);c.dispose();
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
// Batch uploads use the existing single-file transaction on both connections.
// A later file is posted only after the preceding final protocol ACK reports
// complete; stale statuses cannot finish or advance the next transaction.
for(const transport of ['usb','serial']){
 const {c,sent,emit}=fixture();
 const entries=[{file:file('A.hp'),name:'A'},{file:file('B.hp'),name:'B'},{file:file('C.hp'),name:'C'}];
 await c.startUploadBatch(transport,entries);
 const starts=()=>sent.filter(m=>m.type==='file-transfer-start');
 assert.equal(starts().length,1);assert.equal(starts()[0].name,'A');assert.equal(starts()[0].transport,transport);
 assert.deepEqual([...starts()[0].bytes],[...new Uint8Array(await entries[0].file.arrayBuffer())]);
 assert.deepEqual(c.state.uploadBatch.items.map(i=>i.phase),['sending','queued','queued']);
 const first=c.transferRequest;
 emit({type:'file-transfer-status',request:first,active:true,phase:'sending',name:'A.1',transferred:5});
 assert.equal(c.state.uploadBatch.transferred,5);assert.equal(c.state.uploadBatch.items[0].storedName,'A.1');
 await c.startTransfer('get',transport,{name:'UNRELATED'});assert.equal(starts().length,1);
 emit({type:'file-transfer-status',request:first,active:false,phase:'complete',name:'A.1',transferred:entries[0].file.size});
 assert.equal(starts().length,2);assert.equal(starts()[1].name,'B');assert(starts()[1].request>first);
 assert.equal(c.state.uploadBatch.completed,1);assert.equal(c.state.uploadBatch.transferred,entries[0].file.size);
 emit({type:'file-transfer-status',request:first,active:false,phase:'complete'});assert.equal(starts().length,2);
 emit({type:'file-transfer-status',request:c.transferRequest,active:false,phase:'complete'});
 assert.equal(starts().length,3);assert.equal(starts()[2].name,'C');
 emit({type:'file-transfer-status',request:c.transferRequest,active:false,phase:'complete'});
 assert.equal(c.state.uploadBatch.active,false);assert.equal(c.state.uploadBatch.completed,3);
 assert.equal(c.state.uploadBatch.transferred,entries.reduce((n,e)=>n+e.file.size,0));
 assert.deepEqual(c.state.uploadBatch.items.map(i=>i.phase),['complete','complete','complete']);
 assert.equal(c.uploadQueue,null);c.dispose();
}
// All metadata and file contents are validated before ANY remote write.
for(const variant of ['empty','count','duplicate','name','size','aggregate','format','changed','read-error']){
 const {c,sent}=fixture();let reads=0;
 const counted=(name,size=13)=>({...file(name),size,arrayBuffer:async()=>{reads++;return file(name).arrayBuffer();}});
 let entries=[{file:counted('GOOD')},{file:counted('NEXT')}];
 if(variant==='empty')entries=[];
 if(variant==='count')entries=Array.from({length:MAX_UPLOAD_FILES+1},(_,i)=>({file:counted('F'+i)}));
 if(variant==='duplicate')entries[1].name='GOOD';
 if(variant==='name')entries[1].name='../BAD';
 if(variant==='size')entries[1].file.size=MAX_FILE_BYTES+1;
 if(variant==='aggregate')entries=Array.from({length:MAX_UPLOAD_BYTES/MAX_FILE_BYTES+1},(_,i)=>({file:counted('F'+i,MAX_FILE_BYTES)}));
 if(variant==='format')entries[1].file={...file('BAD',new Uint8Array(13)),arrayBuffer:async()=>{reads++;return new ArrayBuffer(13);}};
 if(variant==='changed')entries[1].file.size=12;
 if(variant==='read-error')entries[1].file.arrayBuffer=async()=>{reads++;throw Error('Local read failed');};
 await c.startUploadBatch('usb',entries);
 assert.equal(c.state.transfer.phase,'error',variant);
 assert(!sent.some(m=>m.type==='file-transfer-start'),variant);
 if(!['format','changed','read-error'].includes(variant))assert.equal(reads,0,variant);
 else {assert.equal(reads,2,variant);assert(c.state.uploadBatch.items.every(i=>i.phase==='not-sent'),variant);}
 assert.equal(c.uploadQueue,null,variant);c.dispose();
}
// Bounds include exactly 16 objects and exactly 8 MiB across complete files.
for(const [count,size] of [[MAX_UPLOAD_FILES,13],[4,MAX_FILE_BYTES]]){
 const {c,sent}=fixture();const payload=new Uint8Array(size);payload.set(new TextEncoder().encode('HPHP49-C'));
 await c.startUploadBatch('usb',Array.from({length:count},(_,i)=>({file:file('F'+i,payload)})));
 assert.equal(sent.filter(m=>m.type==='file-transfer-start').length,1);
 assert.equal(c.state.uploadBatch.total,count*size);c.cancelTransfer();c.dispose();
}
// Cancel during preparation stops later reads and starts no protocol, even
// when the in-progress local read resolves after a ROM or connection change.
for(const action of ['cancel','disconnect','worker-disconnect','generation','dispose']){
 const {c,sent,emit}=fixture();let release,laterReads=0;
 const delayed={...file('FIRST'),arrayBuffer:()=>new Promise(r=>{release=r;})};
 const later={...file('SECOND'),arrayBuffer:async()=>{laterReads++;return file().arrayBuffer();}};
 const preparing=c.startUploadBatch('usb',[{file:delayed},{file:later}]);
 if(action==='cancel')c.cancelTransfer();
 else if(action==='disconnect')c.connectLink('usb',false);
 else if(action==='worker-disconnect')emit({type:'usb-status',connected:false,phase:'Disconnected'});
 else if(action==='generation')c.create();else c.dispose();
 release(await file().arrayBuffer());await preparing;
 assert.equal(laterReads,0,action);assert(!sent.some(m=>m.type==='file-transfer-start'),action);
 if(['cancel','disconnect','worker-disconnect'].includes(action))assert.deepEqual(c.state.uploadBatch.items.map(i=>i.phase),['not-sent','not-sent']);
 c.dispose();
}
// Failure/cancellation never retracts an acknowledged earlier upload, never
// reports pending items as uploaded, and never auto-retries a stored object.
for(const [transport,action] of [['usb','error'],['usb','cancel'],['usb','disconnect'],['serial','worker-disconnect'],['usb','pause'],['usb','save'],['usb','fatal'],['usb','stop'],['usb','generation']]){
 const {c,sent,emit}=fixture();c.patch({running:true});
 await c.startUploadBatch(transport,['FIRST','SECOND','THIRD'].map(name=>({file:file(name)})));
 emit({type:'file-transfer-status',request:c.transferRequest,active:false,phase:'complete'});
 const second=c.transferRequest;assert.equal(sent.filter(m=>m.type==='file-transfer-start').length,2);
 if(action==='error')emit({type:'file-transfer-status',request:second,active:false,phase:'error',error:'Calculator full'});
 else if(action==='cancel')c.cancelTransfer();
 else if(action==='disconnect')c.connectLink(transport,false);
 else if(action==='worker-disconnect')emit({type:'serial-status',connected:false});
 else if(action==='fatal')emit({type:'fatal',message:'Worker unavailable'});
 else if(action==='stop')emit({type:'snapshot',loaded:true,running:false,stopped:true});
 else if(action==='generation')c.create();else c[action]();
 emit({type:'file-transfer-status',request:second,active:false,phase:'complete'});
 assert.equal(sent.filter(m=>m.type==='file-transfer-start').length,2,action);
 if(action!=='generation'){
   assert.equal(c.state.uploadBatch.completed,1,action);assert.equal(c.state.uploadBatch.active,false,action);
   assert.deepEqual(c.state.uploadBatch.items.map(i=>i.phase),['complete',['error','fatal','stop'].includes(action)?'error':'cancelled','not-sent'],action);
 }else assert.equal(c.state.uploadBatch,null);
 assert.equal(c.uploadQueue,null,action);c.dispose();
}
// The unrelated link cannot cancel an active upload batch.
for(const transport of ['usb','serial']){
 const {c,emit}=fixture();await c.startUploadBatch(transport,[{file:file('A')},{file:file('B')}]);
 emit({type:transport==='usb'?'serial-status':'usb-status',connected:false,phase:'Disconnected'});
 assert(c.state.uploadBatch.active);assert(c.state.transfer.active);c.dispose();
}
// A cancellation observed between files must win before the next postMessage.
{
 const {c,sent,emit}=fixture();await c.startUploadBatch('usb',[{file:file('A')},{file:file('B')}]);
 const unsubscribe=c.subscribe(()=>{if(c.state.uploadBatch?.active&&c.state.uploadBatch.completed===1)c.cancelTransfer();});
 emit({type:'file-transfer-status',request:c.transferRequest,active:false,phase:'complete'});unsubscribe();
 assert.equal(sent.filter(m=>m.type==='file-transfer-start').length,1);
 assert.deepEqual(c.state.uploadBatch.items.map(i=>i.phase),['complete','not-sent']);c.dispose();
}
console.log('File transfer controller: exact bytes, explicit downloads, bounded files/directories and upload batches; full preflight, sequential acknowledgements, partial failure, cancellation/disconnect, stale generations/requests and reset isolation pass.');
