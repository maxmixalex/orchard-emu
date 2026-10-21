// SPDX-License-Identifier: MIT
// Real Worker handlers and protocol engine, deterministic host/core double.
// This checks ownership and lifecycle boundaries; stock-ROM evidence is separate.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Pacer} from '../web/pacing.js';
import {FileTransfer} from '../web/file-transfer.js';
import {packet,PARAMETERS} from '../web/kermit.js';
import {TapQueue,HP48_ROM,isPlayable,setupHash,applySetup} from '../web/hp48.js';

const source=readFileSync(new URL('../web/worker.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').split('\ntry {\n  const response=await fetch')[0];
const text=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
function fixture(){
  const memory={buffer:new ArrayBuffer(16384)},output=[],writes=[],jobs=new Map(),incoming=[],uartIncoming=[];
  let tick=0,wall=0,next=0;
  const core=new Proxy({memory,timebase_hz:()=>12000000,profile:(_,field)=>[4,8,1,1][field],
    snapshot:()=>{const s=new Uint32Array(memory.buffer,128,33);s[22]=tick;s[28]=0;return 128;},
    run:n=>{tick+=n;return 0;},reset:()=>{tick=0;return 0;},create:()=>{tick=0;return 0;},
    uart_input:()=>1024,uart_output:()=>2048,uart_send:n=>{writes.push(new Uint8Array(memory.buffer,1024,n).slice());return n;},
    uart_receive:()=>{const bytes=uartIncoming.shift();if(!bytes)return 0;new Uint8Array(memory.buffer,2048,bytes.length).set(bytes);return bytes.length;},
    frame_buffer:()=>512,annunciator_buffer:()=>600,usb_snapshot:()=>768,
    checkpoint_size:()=>16,checkpoint_buffer:()=>4096,checkpoint_load:()=>0,
  },{get:(o,k)=>k in o?o[k]:()=>0});
  class Scheduler{schedule(fn){jobs.set(++next,fn);return next;}cancel(id){jobs.delete(id);}}
  class USB{constructor(){this.connected=false;}poll(){}resetLocal(){this.connected=false;}start(){this.connected=true;}
    disconnect(){this.connected=false;}endpoint(){if(!this.connected)throw Error('Connect USB first.');return {maxPacket:64};}
    send(bytes){writes.push(bytes.slice());return {result:0,status:'ACK',accepted:bytes.length};}
    read(){return incoming.length?{result:0,bytes:incoming.shift()}:{result:1,status:'NAK',bytes:new Uint8Array()};}}
  const scope={Pacer,FileTransfer,TaskScheduler:Scheduler,VirtualUSB:USB,TapQueue,HP48_ROM,isPlayable,setupHash,applySetup,
    Uint8Array,Uint32Array,ArrayBuffer,performance:{now:()=>++wall},self:{},postMessage:d=>output.push(d),initialCore:core,
    encodeSession:async()=>new Uint8Array(16),decodeSession:async()=>({model:4,romHash:HP48_ROM,preset:'hp48-home',frameView:1,state:new Uint8Array(16)})};
  const context=vm.createContext(scope);vm.runInContext(source+'\ncore=initialCore;',context);
  const send=data=>scope.self.onmessage({data:{generation:1,...data}});
  send({type:'create',model:4,preset:'hp48-home',audience:'calculator'});
  vm.runInContext("loaded=true;romHash=HP48_ROM;",context);
  send({type:'configure',speed:0});send({type:'run'});send({type:'serial-connect',connected:true});send({type:'usb-connect',connected:true});
  const inspect=vm.runInContext('()=>({running,generation,active:transfer.active,request:transfer.request})',context);
  return {send,output,writes,inspect,incoming,pump(){const [id,fn]=jobs.entries().next().value;assert(fn);jobs.delete(id);fn();}};
}
function start(f,request=1,extra={}){f.send({type:'file-transfer-start',request,transport:'usb',mode:'receive',...extra});}
function final(f,request){return f.output.filter(e=>e.type==='file-transfer-status'&&e.request===request).at(-1);}

for(const extra of [{mode:'send',name:'ROM',bytes:new Uint8Array(16)},{mode:'unknown'},{transport:'invalid'},{transport:'serial'}]){
  const f=fixture();start(f,1,extra);assert.equal(final(f,1).phase,'error');assert.equal(final(f,1).active,false);
  assert.equal(f.inspect().running,true,'Invalid transfer input must not pause the calculator');assert(!f.output.some(e=>e.type==='error'));
}
{
  const f=fixture();f.send({type:'usb-connect',connected:false});start(f);assert.equal(final(f,1).phase,'error');assert(f.inspect().running);
  f.send({type:'pause'});start(f,2);assert.equal(final(f,2).phase,'error');
}
for(const action of ['pause','reset','create','checkpoint-load','usb-connect']){
  const f=fixture();start(f);assert(f.inspect().active);
  f.send(action==='create'?{type:action,generation:2,model:4,preset:'hp48-home',audience:'calculator'}:
    action==='checkpoint-load'?{type:action,file:new ArrayBuffer(16)}:action==='usb-connect'?{type:action,connected:false}:{type:action});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(final(f,1).phase,'cancelled',action);assert.equal(final(f,1).active,false,action);assert(!f.inspect().active,action);
  assert(!f.output.some(e=>e.type==='file-transfer-received'));
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
  f.send({type:'file-transfer-cancel',request:2});assert(f.inspect().active);assert.equal(f.output.length,before);
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
console.log('Worker file transfer: validation without machine pause; stream ownership; generation/request isolation; pause/reset/restore/create/disconnect cancellation; validated complete-file delivery pass.');
