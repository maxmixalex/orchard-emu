// SPDX-License-Identifier: MIT
// Actual Worker/controller lifecycle and ownership handlers. The HTTP/USB
// transaction path is tested with the production core in host-bridge.mjs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {CalculatorController} from '../web/controller.js';
import {Pacer} from '../web/pacing.js';
import {FileTransfer} from '../web/file-transfer.js';
import {transferError,transferErrorDetails} from '../web/transfer-errors.js';
import {BuzzerStream} from '../web/buzzer-worker.js';
import {LCDFrames} from '../web/lcd-frames.js';
import {IrDAInput} from '../web/irda-input.js';
import {readSDState,validateSDSize} from '../web/sd-card.js';
import {MAX_STATE} from '../web/session.js';
import {TapQueue,HP48_ROM,isPlayable,setupHash,applySetup} from '../web/hp48.js';
import {bridgeAddress,bridgeToken} from '../web/host-bridge-protocol.js';
const source=readFileSync(new URL('../web/worker.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').split('\ntry {\n  const response=await fetch')[0];
const address='http://127.0.0.1:8125',token='2'.repeat(64);
function fixture(){
 const memory={buffer:new ArrayBuffer(16384)},output=[],jobs=new Map(),bridges=[];let tick=0,wall=0,next=0,saved=0,stop=0;
 const core=new Proxy({memory,timebase_hz:()=>12000000,profile:(_,field)=>[4,8,1,1][field],
  snapshot:()=>{const s=new Uint32Array(memory.buffer,128,33);s[22]=tick;s[28]=stop;return 128;},
  run:n=>{tick+=n;return stop;},create:()=>{tick=0;return 0;},reset:()=>{tick=0;return 0;},
  frame_buffer:()=>512,annunciator_buffer:()=>600,usb_snapshot:()=>768,
  checkpoint_size:()=>32,checkpoint_buffer:()=>4096,checkpoint_load:()=>0,checkpoint_save:()=>{++saved;return 0;},
 },{get:(o,k)=>k in o?o[k]:()=>0});
 class Scheduler{schedule(fn){jobs.set(++next,fn);return next;}cancel(id){jobs.delete(id);}}
 class USB{constructor(){this.connected=false;}poll(){}resetLocal(){this.connected=false;}start(){this.connected=true;}disconnect(){this.connected=false;}endpoint(){return {maxPacket:64};}send(){return {result:0};}read(){return {result:1,bytes:new Uint8Array()};}}
 class Bridge{constructor(c,{notify}){assert.equal(c,core);this.notify=notify;this.active=false;this.stops=0;this.polls=0;bridges.push(this);}async start(a,t){assert.equal(a,address);assert.equal(t,token);this.active=true;this.notify({active:true,phase:'enumerating'});}poll(){this.polls++;}stop(){this.active=false;++this.stops;this.notify({active:false,phase:'disconnected'});return Promise.resolve();}}
 const scope={Pacer,FileTransfer,transferError,transferErrorDetails,BuzzerStream,LCDFrames,IrDAInput,readSDState,validateSDSize,MAX_STATE,TapQueue,HP48_ROM,isPlayable,setupHash,applySetup,bridgeAddress,bridgeToken,TaskScheduler:Scheduler,VirtualUSB:USB,BrowserHostBridge:Bridge,
  Uint8Array,Uint32Array,ArrayBuffer,performance:{now:()=>++wall},self:{},postMessage:d=>output.push(d),initialCore:core,
  encodeSession:async()=>new Uint8Array(32),decodeSession:async()=>({model:4,romHash:HP48_ROM,preset:'hp48-home',frameView:1,state:new Uint8Array(32)})};
 const context=vm.createContext(scope);vm.runInContext(source+'\ncore=initialCore;',context);
 const send=data=>scope.self.onmessage({data:{generation:1,...data}});
 send({type:'create',model:4,preset:'hp48-home',audience:'calculator'});vm.runInContext('loaded=true;romHash=HP48_ROM;',context);send({type:'configure',speed:0});send({type:'run'});
 const inspect=vm.runInContext('()=>({running,generation,serial,usb:usb.connected,active:transfer.active,bridgeActive:Boolean(hostBridge?.active),pending:taps.pending})',context);
 return {send,output,bridges,inspect,get saved(){return saved;},halt(){stop=5;},pump(){const [id,fn]=jobs.entries().next().value;assert(fn);jobs.delete(id);fn();}};
}
const connect=f=>f.send({type:'host-bridge-start',address,token});
{
 const f=fixture();f.send({type:'serial-connect',connected:true});f.send({type:'usb-connect',connected:true});f.send({type:'file-transfer-start',request:1,transport:'usb',mode:'receive'});assert(f.inspect().active);
 connect(f);assert(f.inspect().bridgeActive);assert(!f.inspect().active&&!f.inspect().serial&&!f.inspect().usb);assert(f.output.some(s=>s.type==='links-reset'));f.pump();assert(f.bridges[0].polls>0);
 const count=f.output.length;for(const type of ['serial-connect','usb-connect','usb-send','usb-read','uart'])f.send({type,connected:true,bytes:new Uint8Array([1])});
 assert.equal(f.output.slice(count).filter(e=>e.type==='host-bridge-conflict').length,5);assert(f.inspect().bridgeActive&&f.inspect().running);
 f.send({type:'file-transfer-start',request:2,transport:'usb',mode:'receive'});assert.equal(f.output.at(-1).errorCode,'hostBridgeBusy');
 f.send({type:'checkpoint-auto',request:10});assert.equal(f.output.at(-1).type,'checkpoint-skipped');assert.equal(f.saved,0);
 f.send({type:'system-chord',action:'self-test'});assert.equal(f.inspect().pending,0);
 f.send({type:'host-bridge-stop'});assert.equal(f.bridges[0].stops,1);assert(!f.inspect().bridgeActive);f.send({type:'usb-connect',connected:true});assert(f.inspect().usb);
 connect(f);assert.equal(f.bridges.length,2,'Reconnect owns a fresh bridge object');assert(f.inspect().bridgeActive);
}
for(const action of ['pause','reset','create','checkpoint-save','checkpoint-load','stop']){
 const f=fixture();connect(f);const bridge=f.bridges[0];
 if(action==='stop'){f.halt();f.pump();}
 else f.send(action==='create'?{type:action,generation:2,model:4,preset:'hp48-home',audience:'calculator'}:action==='checkpoint-load'?{type:action,file:new ArrayBuffer(16)}:{type:action});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(bridge.stops,1,action);assert(!f.inspect().bridgeActive,action);assert(!f.output.some(e=>e.type==='error'),action);
 if(action==='create'){bridge.notify({active:true,phase:'ready'});assert.equal(f.output.at(-1).generation,1,'Old callbacks retain their source generation');assert.equal(f.inspect().generation,2);}
}
{
 const f=fixture();f.send({type:'host-bridge-start',address:'https://remote.invalid',token});assert.equal(f.output.at(-1).errorCode,'hostBridgeInvalidAddress');assert(f.inspect().running);assert.equal(f.bridges.length,0);
 f.send({type:'pause'});connect(f);assert.equal(f.output.at(-1).errorCode,'hostBridgeNotReady');assert.equal(f.bridges.length,0);
}
// Controller validates before sending, preserves active ownership across link
// reset messages, and discards late events from a replaced calculator.
{
 const sent=[],worker={postMessage:m=>sent.push(m),terminate(){}};const c=new CalculatorController({worker,storage:null,database:null});c.patch({ready:true,loaded:true});
 c.connectHostBridge('http://example.invalid:8125',token);assert.equal(c.state.hostBridge.errorCode,'hostBridgeInvalidAddress');assert.equal(sent.length,0);
 c.connectHostBridge(address,token);assert.deepEqual(sent.slice(-2).map(m=>m.type),['run','host-bridge-start']);assert(c.state.hostBridge.active);
 c.receive({type:'links-reset',generation:0});assert(c.state.hostBridge.active);
 const count=sent.length;c.systemChord('self-test');assert.equal(sent.length,count);c.connectLink('usb',true);assert.equal(c.state.dialog.message,'hostBridgeDisconnectFirst');c.answer(null);
 await c.startTransfer('receive','usb');assert.equal(c.state.dialog.message,'hostBridgeDisconnectFirst');c.answer(null);assert.equal(sent.length,count);
 c.requestAuto();assert(!c.autoPending);c.receive({type:'host-bridge-status',generation:0,active:true,ready:true,attached:true,phase:'attached',usbipPort:3240});assert(c.state.hostBridge.attached);
 c.disconnectHostBridge();assert.equal(sent.at(-1).type,'host-bridge-stop');assert(!c.state.hostBridge.active);
 const oldRequest=c.hostBridgeRequest-1;c.connectHostBridge(address,token);c.receive({type:'host-bridge-status',generation:0,request:oldRequest,active:false,phase:'disconnected'});assert(c.state.hostBridge.active,'Late disconnect from an older attempt cannot clear a new connecting state');
 c.create();c.receive({type:'host-bridge-status',generation:0,active:true,phase:'ready'});assert(!c.state.hostBridge.active);
 c.patch({loaded:true});c.connectHostBridge(address,token);worker.onerror();assert(!c.state.hostBridge.active);assert.equal(sent.at(-1).type,'host-bridge-stop');c.dispose();
}
console.log('Host bridge ownership: internal USB/serial cancellation and exclusion, self-test/autosave guards, pause/reset/restore/model/stop teardown, source generation isolation, fresh reconnect and translated controller errors passed.');
