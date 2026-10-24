// SPDX-License-Identifier: MIT
import {readSDState,validateSDSize} from '../web/sd-card.js';
import {MAX_STATE} from '../web/session.js';
// Real Worker handlers and protocol engine, deterministic host/core double.
// This checks ownership and lifecycle boundaries; stock-ROM evidence is separate.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Pacer} from '../web/pacing.js';
import {FileTransfer} from '../web/file-transfer.js';
import {CalculatorController} from '../web/controller.js';
import {CALCULATORS} from '../web/catalog.js';
import {transferError,transferErrorDetails} from '../web/transfer-errors.js';
import {BuzzerStream} from '../web/buzzer-worker.js';
import {LCDFrames} from '../web/lcd-frames.js';
import {IrDAInput} from '../web/irda-input.js';
import {packet,PARAMETERS} from '../web/kermit.js';
import {prepareHp39WireFile,hp39WireBlock} from '../web/hp39-wire.js';
import {TapQueue,HP48_ROM,isPlayable,setupHash,applySetup} from '../web/hp48.js';

const source=readFileSync(new URL('../web/worker.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').split('\ntry {\n  const response=await fetch')[0];
const text=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
function fixture({model=4}={}){
  const memory={buffer:new ArrayBuffer(16384)},output=[],writes=[],jobs=new Map(),incoming=[],uartIncoming=[];
  let tick=0,wall=0,next=0;
  const core=new Proxy({memory,timebase_hz:()=>12000000,profile:(_,field)=>[4,8,1,1][field],
    snapshot:()=>{const s=new Uint32Array(memory.buffer,128,33);s[22]=tick;s[28]=0;return 128;},
    run:n=>{tick+=n;return 0;},reset:()=>{tick=0;return 0;},create:()=>{tick=0;return 0;},
    uart_input:()=>1024,uart_output:()=>2048,uart_send:n=>{writes.push(new Uint8Array(memory.buffer,1024,n).slice());return n;},
    uart_receive:()=>{const bytes=uartIncoming.shift();if(!bytes)return 0;new Uint8Array(memory.buffer,2048,bytes.length).set(bytes);return bytes.length;},
    frame_buffer:()=>512,annunciator_buffer:()=>600,usb_snapshot:()=>768,
    checkpoint_size:()=>32,checkpoint_buffer:()=>4096,checkpoint_load:()=>0,
  },{get:(o,k)=>k in o?o[k]:()=>0});
  class Scheduler{schedule(fn){jobs.set(++next,fn);return next;}cancel(id){jobs.delete(id);}}
  class USB{constructor(){this.connected=false;}poll(){}resetLocal(){this.connected=false;}start(){this.connected=true;}
    disconnect(){this.connected=false;}endpoint(){if(!this.connected)throw Error('Connect USB first.');return {maxPacket:64};}
    send(bytes){writes.push(bytes.slice());return {result:0,status:'ACK',accepted:bytes.length};}
    read(){return incoming.length?{result:0,bytes:incoming.shift()}:{result:1,status:'NAK',bytes:new Uint8Array()};}}
  const scope={transferError,transferErrorDetails,readSDState,validateSDSize,MAX_STATE,Pacer,FileTransfer,BuzzerStream,LCDFrames,IrDAInput,TaskScheduler:Scheduler,VirtualUSB:USB,TapQueue,HP48_ROM,isPlayable,setupHash,applySetup,
    Uint8Array,Uint32Array,ArrayBuffer,performance:{now:()=>++wall},self:{},postMessage:d=>output.push(d),initialCore:core,
    encodeSession:async()=>new Uint8Array(32),decodeSession:async()=>({model:4,romHash:HP48_ROM,preset:'hp48-home',frameView:1,state:new Uint8Array(32)})};
  const context=vm.createContext(scope);vm.runInContext(source+'\ncore=initialCore;',context);
  const send=data=>scope.self.onmessage({data:{generation:1,...data}});
  send({type:'create',model,preset:model===1?'hp39-home':model===2?'hp39gs-home':'hp48-home',audience:'calculator'});
  vm.runInContext("loaded=true;romHash=HP48_ROM;",context);
  send({type:'configure',speed:0});send({type:'run'});send({type:'serial-connect',connected:true});send({type:'usb-connect',connected:true});
  const inspect=vm.runInContext('()=>({running,generation,active:transfer.active,pending:transfer.pending,request:transfer.request,speed:pacer.speed,requestedSpeed,transferUnlimited,transferBoosted:transferBoosted()})',context);
  return {send,output,writes,inspect,incoming,uartIncoming,pump(){const [id,fn]=jobs.entries().next().value;assert(fn);jobs.delete(id);fn();}};
}
function start(f,request=1,extra={}){f.send({type:'file-transfer-start',request,transport:'usb',mode:'receive',...extra});}
function final(f,request){return f.output.filter(e=>e.type==='file-transfer-status'&&e.request===request).at(-1);}

for(const model of [1,2]){
  const f=fixture({model});f.send({type:'configure',speed:.5,transferUnlimited:true});start(f,1,{protocol:'hp39-wire'});
  assert.equal(final(f,1).phase,'listening');assert.equal(f.inspect().speed,.5);f.pump();
  for(let index=0;index<2;index++){
    const bytes=prepareHp39WireFile('NOTE',text(`HP39AscC 1 ${index}Wire note ${index}.`)).bytes,padded=new Uint8Array(128);padded.set(bytes);
    f.incoming.push(hp39WireBlock(1,padded));f.pump();assert.equal(f.inspect().speed,0,'Receiving boosts; waiting for the next SEND does not');
    f.pump();f.incoming.push(Uint8Array.of(4));f.pump();
    const files=f.output.filter(e=>e.type==='file-transfer-received');assert.equal(files.length,index+1);assert.deepEqual(files[index].bytes,bytes);
    assert.equal(final(f,1).phase,'listening');assert.equal(f.inspect().speed,.5);assert(f.inspect().active);f.pump();f.pump();
  }
  f.send({type:'file-transfer-cancel',request:1});assert.equal(f.inspect().active,false);assert.equal(f.inspect().speed,.5);
  assert.equal(f.output.filter(e=>e.type==='file-transfer-received').length,2);
}
for(const model of [1,2])for(const boundary of ['files','bytes']){
  const f=fixture({model}),bytes=prepareHp39WireFile('NOTE',text('HP39AscC 1 NLast note.')).bytes,padded=new Uint8Array(128);padded.set(bytes);
  f.send({type:'configure',speed:.5,transferUnlimited:true});
  start(f,1,{protocol:'hp39-wire',receiveBudget:{files:boundary==='files'?1:16,bytes:boundary==='bytes'?bytes.length:8*1024*1024}});f.pump();
  f.incoming.push(hp39WireBlock(1,padded));f.pump();assert.equal(f.inspect().speed,0);f.pump();
  f.incoming.push(Uint8Array.of(4));f.pump();assert.equal(final(f,1).phase,'complete');
  assert.equal(f.inspect().active,false);assert(f.inspect().pending,'Completed receiver still owns final EOT recovery');
  assert.equal(f.inspect().speed,.5);assert.equal(f.inspect().transferBoosted,false,'Terminal ACK recovery is never accelerated');
  f.pump();f.incoming.push(Uint8Array.of(4));f.pump();f.pump();
  assert.equal(f.inspect().speed,.5);assert.equal(f.output.filter(e=>e.type==='file-transfer-received').length,1);
  f.send({type:'file-transfer-cancel',request:1});assert.equal(f.inspect().pending,false);assert.equal(f.inspect().speed,.5);
}

for(const extra of [{mode:'send',name:'ROM',bytes:new Uint8Array(16)},{mode:'unknown'},{transport:'invalid'}]){
  const f=fixture();start(f,1,extra);assert.equal(final(f,1).phase,'error');assert.equal(final(f,1).active,false);
  assert.equal(f.inspect().running,true,'Invalid transfer input must not pause the calculator');assert(!f.output.some(e=>e.type==='error'));
}
{
  const f=fixture();f.send({type:'usb-connect',connected:false});start(f);assert.equal(final(f,1).phase,'error');assert(f.inspect().running);
  f.send({type:'pause'});start(f,2);assert.equal(final(f,2).phase,'error');
  assert.equal(final(f,2).errorCode,'calculatorNotReady','Worker catch retains the translatable code');
}
for(const transport of ['usb','serial'])for(const action of ['pause','reset','create','checkpoint-load','disconnect']){
  const f=fixture();start(f,1,{transport,mode:transport==='usb'?'receive':'get',name:'OBJECT'});assert(f.inspect().active);
  f.send(action==='create'?{type:action,generation:2,model:4,preset:'hp48-home',audience:'calculator'}:
    action==='checkpoint-load'?{type:action,file:new ArrayBuffer(16)}:action==='disconnect'?{type:transport+'-connect',connected:false}:{type:action});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(final(f,1).phase,'cancelled',action);assert.equal(final(f,1).active,false,action);assert(!f.inspect().active,action);
  assert(!f.output.some(e=>e.type==='file-transfer-received'));
  if(action==='checkpoint-load')assert(!f.output.some(e=>e.type==='error'),'Valid restore must complete after cancelling the transfer');
}
{
  const f=fixture();start(f,1,{transport:'serial',mode:'send',name:'OBJECT',bytes:text('HPHP49-Cdata')});
  assert(f.inspect().active);f.pump();assert(f.writes.length>0,'Serial upload reaches the UART adapter');
  const count=f.writes.length;f.send({type:'uart',bytes:text('raw')});
  assert.equal(f.output.at(-1).accepted,0);assert.equal(f.writes.length,count);
  f.send({type:'usb-connect',connected:false});assert(f.inspect().active,'USB disconnect must not cancel a serial file');
  f.send({type:'file-transfer-cancel',request:2});assert(f.inspect().active);
  f.send({type:'file-transfer-cancel',request:1});assert.equal(final(f,1).phase,'cancelled');
}
{
  const f=fixture();start(f,1,{transport:'serial',mode:'get',name:'OBJECT'});f.pump();
  for(const p of [packet(0,'Y',PARAMETERS),packet(0,'S',PARAMETERS),packet(1,'F',text('OBJECT')),
    packet(2,'D',text('HPHP49-Cdata')),packet(3,'Z')]){
    f.uartIncoming.push(p);f.pump();assert(!f.output.some(e=>e.type==='file-transfer-received'));
  }
  f.uartIncoming.push(packet(4,'B'));f.pump();
  const files=f.output.filter(e=>e.type==='file-transfer-received');assert.equal(files.length,1);
  assert.deepEqual(files[0].bytes,text('HPHP49-Cdata'));assert.equal(final(f,1).phase,'complete');
  assert(!f.output.some(e=>e.type==='uart-output'),'Serial Kermit packets must not leak into the raw terminal');
  assert(f.inspect().running);
}
// Serial receive and remote commands own the UART through their final ACK;
// they must not need a USB host or publish partial output.
for(const mode of ['receive','directory','finish']){
  const f=fixture();f.send({type:'usb-connect',connected:false});
  start(f,1,{transport:'serial',mode});f.pump();assert(f.inspect().active);
  const incoming=p=>{f.uartIncoming.push(p);f.pump();};
  if(mode!=='receive')incoming(packet(0,'Y',PARAMETERS));
  if(mode==='finish')incoming(packet(0,'Y'));
  else {
    incoming(packet(0,'S',PARAMETERS));
    incoming(packet(1,mode==='directory'?'X':'F',text(mode==='directory'?'Directory':'OBJECT')));
    incoming(packet(2,'D',text(mode==='directory'?'OBJECT 45':'HPHP49-Cdata')));
    incoming(packet(3,'Z'));
    assert(!f.output.some(e=>['file-transfer-received','file-transfer-listing'].includes(e.type)));
    incoming(packet(4,'B'));
  }
  assert.equal(final(f,1).phase,'complete',mode);assert.equal(final(f,1).transport,'serial');
  assert(f.inspect().running);assert(!f.output.some(e=>e.type==='uart-output'));
  const files=f.output.filter(e=>e.type==='file-transfer-received');
  const listings=f.output.filter(e=>e.type==='file-transfer-listing');
  assert.equal(files.length,mode==='receive'?1:0);assert.equal(listings.length,mode==='directory'?1:0);
  if(files.length)assert.deepEqual(files[0].bytes,text('HPHP49-Cdata'));
  if(listings.length)assert.equal(listings[0].text,'OBJECT 45');
}
{
  const f=fixture();f.send({type:'usb-connect',connected:true});start(f,1,{transport:'usb'});assert(f.inspect().active);
  f.send({type:'usb-send',bytes:text('raw')});assert.equal(f.output.at(-1).result,4);
  f.send({type:'usb-read'});assert.equal(f.output.at(-1).result,4);
  f.send({type:'usb-connect',connected:false});assert.equal(final(f,1).phase,'cancelled');assert(!f.inspect().active);
}
{
  const f=fixture();start(f);const before=f.output.length;
  f.send({type:'file-transfer-start',request:1,transport:'usb',mode:'receive'});
  f.send({type:'file-transfer-cancel',generation:0,request:1});
  assert.equal(f.output.length,before,'Old-generation cancellation has no effect');
  f.send({type:'file-transfer-cancel',request:2});assert(f.inspect().active);
  assert.deepEqual(f.output.slice(before).map(e=>({...e})),[{type:'file-transfer-cancelled',generation:1,request:2}],'A nonexistent request is confirmed without cancelling another owner');
  const count=f.writes.length;f.send({type:'usb-send',bytes:text('raw')});assert.equal(f.output.at(-1).accepted,0);assert.equal(f.writes.length,count);
  for(const p of [packet(0,'S',PARAMETERS),packet(1,'F',text('OBJECT')),packet(2,'D',text('HPHP49-Cdata')),packet(3,'Z')]){
    f.incoming.push(p);f.pump();assert(!f.output.some(e=>e.type==='file-transfer-received'));
  }
  f.incoming.push(packet(4,'B'));f.pump();
  const files=f.output.filter(e=>e.type==='file-transfer-received');assert.equal(files.length,1);
  assert.equal(files[0].generation,1);assert.equal(files[0].request,1);assert.deepEqual(files[0].bytes,text('HPHP49-Cdata'));
  assert.equal(final(f,1).phase,'complete');assert.equal(final(f,1).active,false);assert(f.inspect().running);
  assert(!f.output.some(e=>e.type==='uart-output'),'Owned Kermit bytes must not leak into the raw terminal');
  start(f,2);f.send({type:'file-transfer-cancel',request:1});assert(f.inspect().active);
  f.send({type:'file-transfer-cancel',request:2});assert.equal(final(f,2).phase,'cancelled');
}
for(const rejected of [false,true]){
  const f=fixture();if(rejected)start(f,7,{mode:'send',name:'INVALID',bytes:new Uint8Array(1)});
  f.send({type:'file-transfer-cancel',request:7});assert.equal(f.output.at(-1).type,'file-transfer-cancelled');
  assert.equal(f.output.at(-1).request,7);assert.equal(f.inspect().active,false,'Cancellation confirms even when no session was created');
}
// Run the real Controller, Worker handler and FileTransfer together, but defer
// delivery of Worker messages. The user task can run before an already-posted
// file message; FIFO only orders messages from the Worker with each other.
for(const model of [1,2])for(const ending of ['stop','pause','protocol-error','capacity-complete']){
  const f=fixture({model}),sent=[],downloads=[];let delivered=f.output.length;
  const c=new CalculatorController({worker:{postMessage:data=>{sent.push(data);f.send(data);},terminate(){}},
    download:(bytes,name)=>downloads.push({bytes,name})});
  c.generation=1;c.patch({model:CALCULATORS.find(m=>m.id===model),ready:true,loaded:true,running:true,usb:true,usbReady:true});
  const deliver=()=>c.receive(f.output[delivered++]);
  const flush=()=>{while(delivered<f.output.length)deliver();};
  const sendNote=index=>{
    const bytes=prepareHp39WireFile('NOTE',text(`HP39AscC 1 NCompleted note ${index}.`)).bytes,padded=new Uint8Array(128);padded.set(bytes);
    f.incoming.push(hp39WireBlock(1,padded));f.pump();f.pump();f.incoming.push(Uint8Array.of(4));f.pump();f.pump();f.pump();return bytes;
  };
  await c.startTransfer('receive','usb',{protocol:'hp39-wire'});flush();f.pump();
  const request=c.transferRequest,earlier=ending==='capacity-complete'?15:1;
  for(let i=0;i<earlier;i++){sendNote(i);flush();}
  assert.equal(c.received.size,earlier);
  const last=sendNote(earlier);
  assert.equal(f.output.filter(e=>e.type==='file-transfer-received').length,earlier+1,'Worker has completed and posted the file before Stop');
  assert.equal(c.received.size,earlier,'Main-thread delivery is deliberately delayed');
  if(ending==='protocol-error'){
    f.incoming.push(hp39WireBlock(1,new Uint8Array(128)));f.pump();f.pump();f.incoming.push(Uint8Array.of(4));f.pump();
    assert.equal(final(f,request).phase,'error');
  }else if(ending==='capacity-complete')assert.equal(final(f,request).phase,'complete');
  if(ending==='pause')c.pause();else c.cancelTransfer();
  assert.equal(c.state.transfer.phase,'cancelling');assert.equal(c.transferRequest,request);assert(c.state.transfer.active);
  const starts=sent.filter(e=>e.type==='file-transfer-start').length;
  await c.startTransfer('receive','usb',{protocol:'hp39-wire'});c.clearTransferredFiles();
  assert.equal(sent.filter(e=>e.type==='file-transfer-start').length,starts);assert.equal(c.received.size,earlier);
  c.receive({type:'file-transfer-cancelled',generation:0,request});c.receive({type:'file-transfer-cancelled',generation:1,request:request+1});
  assert.equal(c.state.transfer.phase,'cancelling','Unrelated barriers cannot release this request');
  while(f.output[delivered]?.type!=='file-transfer-cancelled'){
    assert(delivered<f.output.length,'Worker must emit its explicit cancellation barrier');deliver();
    assert.equal(c.state.transfer.phase,'cancelling','Queued completion/error cannot close the request before its barrier');
    assert.equal(c.transferRequest,request);
  }
  assert.equal(c.received.size,earlier+1,'All completed files ahead of the barrier are retained');
  deliver();flush();assert.equal(c.state.transfer.phase,'cancelled');assert.equal(c.state.transfer.active,false);assert.equal(c.transferCancelRequest,null);
  c.downloadTransferredFile(c.state.receivedFiles.at(-1).id);await Promise.resolve();assert.deepEqual(downloads.at(-1).bytes,last);
  const retained=c.received.size;
  c.receive({type:'file-transfer-received',generation:1,request,name:'AFTER',bytes:Uint8Array.of(99)});assert.equal(c.received.size,retained);
  if(ending==='capacity-complete')c.clearTransferredFiles();
  await c.startTransfer('receive','usb',{protocol:'hp39-wire'});const next=c.transferRequest;
  assert(next>request);assert.equal(sent.filter(e=>e.type==='file-transfer-start').at(-1).receiveBudget.files,16-c.received.size);
  c.receive({type:'file-transfer-cancelled',generation:1,request});c.receive({type:'file-transfer-received',generation:1,request,name:'OLD',bytes:Uint8Array.of(99)});
  assert.equal(c.transferRequest,next);assert(c.state.transfer.active);flush();c.cancelTransfer();flush();c.dispose();
}
// The actual Worker applies the speed override after the protocol handshake,
// and restores it synchronously before a terminal message reaches the UI.
// No host sleep, test-only core budget or controller speed rewrite is involved.
for(const ending of ['complete','error','cancel','pause','reset','create','disconnect']){
  const f=fixture({model:1});f.send({type:'configure',speed:2,transferUnlimited:true});
  start(f,1,{mode:'send',protocol:'hp39-wire',name:'LIB.any',bytes:text('HP39BinH\x01Lbody')});
  assert.equal(f.inspect().speed,2,'Waiting for RECV uses the user speed');
  f.incoming.push(Uint8Array.of(68));for(let i=0;i<4;i++)f.pump();
  assert.equal(f.inspect().speed,0,ending);assert.equal(f.inspect().requestedSpeed,2);assert(f.inspect().transferBoosted);
  f.send({type:'file-transfer-cancel',request:999});f.send({type:'configure',generation:0,speed:.5});
  assert.equal(f.inspect().speed,0,'Stale request/generation cannot restore or change the live transfer');
  if(ending==='complete'){
    f.incoming.push(Uint8Array.of(6));for(let i=0;i<4;i++)f.pump();
    assert.equal(f.inspect().speed,0,'Payload ACK alone does not finish the transfer');
    f.incoming.push(Uint8Array.of(6));f.pump();assert.equal(final(f,1).phase,'complete');
  }else if(ending==='error'){f.incoming.push(Uint8Array.of(24));f.pump();assert.equal(final(f,1).phase,'error');}
  else if(ending==='cancel')f.send({type:'file-transfer-cancel',request:1});
  else if(ending==='disconnect')f.send({type:'usb-connect',connected:false});
  else if(ending==='create'){
    f.send({type:'create',generation:2,model:4,preset:'hp48-home',audience:'calculator'});
    f.send({type:'configure',generation:2,speed:2,transferUnlimited:true});
  }else f.send({type:ending});
  assert.equal(f.inspect().speed,2,`${ending}: restore user speed`);assert.equal(f.inspect().transferBoosted,false,ending);
  if(ending==='complete'){
    start(f,2,{mode:'send',protocol:'hp39-wire',name:'NEXT',bytes:text('HP39BinH\x01Nbody')});
    assert.equal(f.inspect().speed,2,'The gap between batch files is not accelerated');
  }
}
{
  const f=fixture({model:1});f.send({type:'configure',speed:1,transferUnlimited:true});
  start(f,1,{mode:'send',protocol:'hp39-wire',name:'LIB',bytes:text('HP39BinH\x01Lbody')});
  f.incoming.push(Uint8Array.of(68));for(let i=0;i<4;i++)f.pump();
  f.send({type:'configure',speed:.5});assert.equal(f.inspect().speed,0);assert.equal(f.inspect().requestedSpeed,.5);
  f.send({type:'configure',transferUnlimited:false});assert.equal(f.inspect().speed,.5,'Turning the switch off immediately restores the new user speed');
  f.send({type:'configure',transferUnlimited:true});assert.equal(f.inspect().speed,0);
  f.send({type:'file-transfer-start',request:2,transport:'usb',mode:'receive'});
  assert.equal(f.inspect().speed,0,'An invalid overlapping request cannot change the live override');
  f.send({type:'file-transfer-cancel',request:1});assert.equal(f.inspect().speed,.5,'Completion restores the most recent user choice');
  assert.equal(f.inspect().requestedSpeed,.5);
}
{
  const f=fixture({model:1});f.send({type:'configure',speed:1});
  start(f,1,{mode:'send',protocol:'hp39-wire',name:'LIB',bytes:text('HP39BinH\x01Lbody')});
  f.incoming.push(Uint8Array.of(68));f.pump();
  assert.equal(f.inspect().speed,1,'The optional setting leaves Normal unchanged by default');
}
console.log('Worker file transfer: validation without machine pause; stream ownership; generation/request isolation; pause/reset/restore/create/disconnect cancellation; validated complete-file delivery pass.');
