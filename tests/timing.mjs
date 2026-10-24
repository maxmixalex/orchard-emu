// SPDX-License-Identifier: MIT
import {readSDState,validateSDSize} from '../web/sd-card.js';
import {MAX_STATE} from '../web/session.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {BuzzerStream} from '../web/buzzer-worker.js';
import {LCDFrames} from '../web/lcd-frames.js';
import {IrDAInput} from '../web/irda-input.js';
import {Pacer} from '../web/pacing.js';
import {FileTransfer} from '../web/file-transfer.js';
import {transferError,transferErrorDetails} from '../web/transfer-errors.js';
import {TaskScheduler} from '../web/task-scheduler.js';
import {TapQueue, HP48_ROM, isPlayable, setupHash, applySetup} from '../web/hp48.js';

const p=new Pacer(1000);
p.reset(100);assert.equal(p.available(110),10);p.consume(10);
assert.equal(p.available(105),0);assert.equal(p.available(110),0,'Clock rollback must not mint credit twice');
assert.equal(p.available(1000),50,'Existing 50 ms debt cap is preserved');
p.setSpeed(0,1000);assert.equal(p.available(1000,321),321);assert.equal(p.delay(),0);
p.setSpeed(1,1000);assert.throws(()=>p.reset(NaN));assert.throws(()=>p.setSpeed(2,NaN));assert.equal(p.speed,1);
const normal=new Pacer();normal.available(1);assert.equal(normal.delay(),0,'Backlogged work does not request a timer');normal.consume(12000);assert.ok(normal.delay()>0);
for(const rate of [.5,1,2]){normal.setSpeed(rate,0);assert.equal(normal.available(10,1000000),120000*rate);}

const messages=[],timers=new Map();let timerId=0,closed=0;
const channel={port1:{start(){},close(){closed++;}},port2:{postMessage:id=>messages.push(id),close(){closed++;}}};
const s=new TaskScheduler({channel,setTimer:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)});
let calls=0;const first=s.schedule(()=>calls++);assert.equal(timers.size,0);s.cancel(first);
channel.port1.onmessage({data:messages.shift()});assert.equal(calls,0,'Cancelled channel message is inert');
s.schedule(()=>calls++);channel.port1.onmessage({data:messages.shift()});assert.equal(calls,1);
const delayed=s.schedule(()=>calls++,8);assert.equal(timers.size,1);s.cancel(delayed);assert.equal(timers.size,0);
s.schedule(()=>s.schedule(()=>calls++));channel.port1.onmessage({data:messages.shift()});channel.port1.onmessage({data:messages.shift()});assert.equal(calls,2);
s.schedule(()=>calls++);s.close();channel.port1.onmessage({data:messages.shift()});assert.equal(calls,2);assert.equal(closed,2);assert.throws(()=>s.schedule(()=>{}));
// A self-reposting port must periodically relinquish the event loop to commands.
const fairMessages=[],fairTimers=[];let fairCalls=0;
const fairChannel={port1:{start(){},close(){}},port2:{postMessage:id=>fairMessages.push(id),close(){}}};
const fair=new TaskScheduler({channel:fairChannel,setTimer:fn=>{fairTimers.push(fn);return fairTimers.length;},clearTimer(){}});
const repeat=()=>{if(++fairCalls<12)fair.schedule(repeat);};fair.schedule(repeat);
while(fairMessages.length)fairChannel.port1.onmessage({data:fairMessages.shift()});
assert.equal(fairCalls,4);assert.equal(fairTimers.length,1,'Continuous work must give a timer turn to other ports');
fairTimers.shift()();while(fairMessages.length)fairChannel.port1.onmessage({data:fairMessages.shift()});
assert.equal(fairCalls,9);assert.equal(fairTimers.length,1);fairTimers.shift()();while(fairMessages.length)fairChannel.port1.onmessage({data:fairMessages.shift()});
assert.equal(fairCalls,12);fair.close();

// Execute the actual Worker message handlers with a deterministic core double.
// This tests clock/lifecycle integration, not firmware or hardware correctness.
const source=readFileSync(process.env.ORCHARD_WORKER_PATH||new URL('../web/worker.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').split('\ntry {\n  const response=await fetch')[0];
async function fixture(){
 let clock=240000000,wall=0,loads=0;const jobs=new Map(),presses=[],output=[];let next=0;
 const memory={buffer:new ArrayBuffer(16384)};
 function setClock(n){clock=n;const a=new Uint32Array(memory.buffer,128,33);a[22]=n>>>0;a[23]=Math.floor(n/4294967296);}
 const core=new Proxy({memory,snapshot:()=>{setClock(clock);return 128;},profile:(_,field)=>[4,8,1,1][field],
  run:n=>{setClock(clock+n);return 0;},run_clocked:n=>{setClock(clock+n);return 0;},run_idle:n=>{setClock(clock+n);return 0;},reset:()=>setClock(0),create:()=>{setClock(0);return 0;},load:()=>{loads++;setClock(0);return 0;},
  keyboard_matrix:(col,row,down)=>{presses.push({scan:col*7+row,down,tick:clock});return 0;},
  keyboard_dedicated:(pin,down)=>{presses.push({pin,down,tick:clock});return 0;},
  rom_buffer:()=>1024,frame_buffer:()=>512,annunciator_buffer:()=>600,usb_snapshot:()=>768,
  checkpoint_size:()=>32,checkpoint_buffer:()=>2048,checkpoint_load:()=>{setClock(1000);return 0;},timebase_hz:()=>12000000
 },{get:(o,k)=>k in o?o[k]:()=>0});
 const schedule=fn=>{const id=++next;jobs.set(id,fn);return id;};
 class FakeScheduler{schedule(fn){return schedule(fn);}cancel(id){jobs.delete(id);}}
 class FakeUSB{poll(){}resetLocal(){}}
 const saved={model:4,romHash:HP48_ROM,preset:'hp48-home',frameView:1,state:new Uint8Array(32)};
 const scope={transferError,transferErrorDetails,BuzzerStream,LCDFrames,IrDAInput,readSDState,validateSDSize,MAX_STATE,console,Pacer,FileTransfer,TaskScheduler:FakeScheduler,VirtualUSB:FakeUSB,TapQueue,isPlayable,setupHash,applySetup,
  encodeSession:async()=>new Uint8Array(32),decodeSession:async()=>saved,Uint32Array,Uint8Array,ArrayBuffer,
  setTimeout:schedule,clearTimeout:id=>jobs.delete(id),performance:{now:()=>++wall},
  crypto:{subtle:{digest:async()=>Uint8Array.from(HP48_ROM.match(/../g),b=>parseInt(b,16)).buffer}},
  self:{},postMessage:d=>output.push(d),initialCore:core};
 vm.runInNewContext(source+`\ncore=initialCore;model=4;generation=1;preset='hp48-home';loaded=true;romHash='${HP48_ROM}';tick=240000000;\n`,scope);
 return {send:data=>scope.self.onmessage({data:{generation:1,...data}}),pump:()=>{const [id,fn]=jobs.entries().next().value||[];assert.ok(fn,'Worker scheduled a task');jobs.delete(id);fn();},presses,output,jobs,get loads(){return loads;}};
}
for(const action of ['reset','create','load','checkpoint-load']){
 const f=await fixture();
 f.send(action==='create'?{type:action,model:4,preset:'hp48-home',audience:'calculator'}:action==='load'?{type:action,rom:new ArrayBuffer(4)}:action==='checkpoint-load'?{type:action,file:new ArrayBuffer(16)}:{type:action});
 await new Promise(resolve=>setImmediate(resolve));
 if(action==='create'){f.send({type:'load',rom:new ArrayBuffer(4)});await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(f.output.some(x=>x.type==='error'),false,JSON.stringify(f.output));
 f.send({type:'run'});f.send({type:'tap',scan:26});f.pump();
 const down=f.presses.find(x=>x.down===1);assert.ok(down,`${action}: first tap must not wait for the old 240M tick clock`);
 assert.equal(down.tick,action==='checkpoint-load'?1000:0,`${action}: tap starts at the new clock`);
 f.send({type:'pause'});assert.equal(f.jobs.size,0,'Pause cancels the scheduled continuation');
}
console.log('Timing: pacing invariants, scheduler cancellation/reentrancy and 4 Worker clock-epoch regressions passed');
