// SPDX-License-Identifier: MIT
import {readSDState,validateSDSize} from '../web/sd-card.js';
import {MAX_STATE} from '../web/session.js';
// Execute the real Worker pump against an advancing, high-resolution clock.
// This makes its host-work amplification deterministic; it is not a firmware
// benchmark or a physical-clock oracle. Production-WASM RTC/replay tests are
// separate gates.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {BuzzerStream} from '../web/buzzer-worker.js';
import {LCDFrames} from '../web/lcd-frames.js';
import {IrDAInput} from '../web/irda-input.js';
import {Pacer} from '../web/pacing.js';
import {FileTransfer} from '../web/file-transfer.js';
import {transferError,transferErrorDetails} from '../web/transfer-errors.js';
import {TapQueue,isPlayable,setupHash,applySetup} from '../web/hp48.js';
import {VirtualUSB} from '../web/virtual-usb.js';

const source=readFileSync(process.env.ORCHARD_WORKER_PATH||new URL('../web/worker.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').split('\ntry {\n  const response=await fetch')[0];
function fixture(hostHz,{speed=1,model=1,audience='calculator',preset=model===1?'hp39-home':'hp48-home'}={}) {
  let clock=0,wall=0,next=0,clockReads=0;
  const jobs=new Map(),budgets=[],policies=[],presses=[],output=[];
  const memory={buffer:new ArrayBuffer(16384)};
  const run=(policy,n)=>{policies.push(policy);budgets.push(n);wall+=0.0003+n/(hostHz/1000);clock+=n;return 0;};
  const core=new Proxy({
    memory,
    create:()=>{clock=0;return 0;},
    snapshot:()=>{new Uint32Array(memory.buffer,128,33)[22]=clock;return 128;},
    profile:(_,field)=>[4,8,1,1][field],
    run:n=>run('legacy',n),run_clocked:n=>run('clocked',n),run_idle:n=>run('idle',n),
    keyboard_matrix:(col,row,down)=>{presses.push({scan:col*7+row,down,tick:clock});return 0;},
    frame_buffer:()=>512,annunciator_buffer:()=>600,timebase_hz:()=>12000000
  },{get:(o,k)=>k in o?o[k]:()=>0});
  class Scheduler {
    schedule(fn,delay=0){const id=++next;jobs.set(id,{fn,at:wall+delay});return id;}
    cancel(id){jobs.delete(id);}
  }
  const scope={transferError,transferErrorDetails,BuzzerStream,LCDFrames,IrDAInput,readSDState,validateSDSize,MAX_STATE,Pacer,FileTransfer,TaskScheduler:Scheduler,TapQueue,isPlayable,setupHash,applySetup,VirtualUSB,
    Uint32Array,Uint8Array,ArrayBuffer,self:{},postMessage:d=>output.push(d),initialCore:core,
    // 250 ns for a monotonic-clock read, 300 ns fixed host cost per core call;
    // the requested hostHz supplies only the per-tick cost. Faster clock reads
    // remain above one guest quantum on common high-resolution Node clocks.
    performance:{now:()=>{++clockReads;return wall+=0.00025;}}};
  const context=vm.createContext(scope);
  vm.runInContext(source+'\ncore=initialCore;',context);
  const send=data=>scope.self.onmessage({data:{generation:1,...data}});
  // Exercise the actual create handler, including its model-specific timings.
  // Only ROM loading is bypassed; no configure call overwrites hold/gap.
  send({type:'create',model,preset,audience});
  assert(output.some(x=>x.type==='created'),'The production create handler must succeed');
  assert(!output.some(x=>x.type==='error'),JSON.stringify(output));
  vm.runInContext('loaded=true;',context);
  const input=vm.runInContext('()=>({tick,pending:taps.pending,active:taps.active,readyAt:taps.readyAt,hold:taps.hold,gap:taps.gap})',context);
  // Reserved for the synthetic sub-256 boundary test below, not default tests.
  const syntheticTiming=vm.runInContext('(hold,gap)=>{taps.hold=hold;taps.gap=gap;}',context);
  send({type:'configure',speed});send({type:'run'});
  return {send,budgets,policies,presses,output,jobs,input,syntheticTiming,
    pump(){
      const entry=jobs.entries().next().value;assert.ok(entry,'Worker must schedule its continuation');
      jobs.delete(entry[0]);wall=Math.max(wall,entry[1].at);
      const start=wall,first=budgets.length;entry[1].fn();
      assert(!output.some(x=>x.type==='error'),JSON.stringify(output));
      assert(budgets.slice(first).every(n=>Number.isSafeInteger(n)&&n>0&&n<=1024),'All core calls stay UART-bounded');
      return {ms:wall-start,calls:budgets.length-first,ticks:clock,clockReads};
    }
  };
}

function pumpUntil(f,done) {
  for(let i=0;i<5000;i++){if(done())return;f.pump();}
  assert.fail('Worker did not reach the bounded input witness');
}

// Physical contacts use guest ticks at every wall-time speed. These fixtures
// obtain 125/50 ms from create rather than supplying that timing themselves.
for(const speed of [.5,1,2,0]) {
  const f=fixture(150000000,{speed});
  assert.equal(f.input().hold,1500000);assert.equal(f.input().gap,600000);
  f.send({type:'tap-sequence',scans:[26,5,26,6]});
  pumpUntil(f,()=>f.presses.length===8);
  assert.deepEqual(f.presses,[
    {scan:26,down:1,tick:0},{scan:26,down:0,tick:1500000},
    {scan:5,down:1,tick:2100000},{scan:5,down:0,tick:3600000},
    {scan:26,down:1,tick:4200000},{scan:26,down:0,tick:5700000},
    {scan:6,down:1,tick:6300000},{scan:6,down:0,tick:7800000}
  ]);
  assert.equal(f.input().pending,0);
  assert(f.policies.every(name=>name==='legacy'));
  f.send({type:'pause'});assert.equal(f.jobs.size,0);

  // A queue can be empty while the just-released key's gap is still running.
  // A separately delivered tap must wait for readyAt rather than start now.
  const late=fixture(150000000,{speed});
  late.send({type:'tap',scan:26});pumpUntil(late,()=>late.presses.length===2);
  const released=late.input();
  assert.equal(released.pending,0);assert.equal(released.active,null);
  assert.equal(released.readyAt,2100000);assert(released.tick<released.readyAt);
  late.send({type:'tap',scan:5});
  assert.equal(late.presses.length,2,'Enqueueing during the gap must not press immediately');
  pumpUntil(late,()=>late.presses.length===4);
  assert.deepEqual(late.presses,[
    {scan:26,down:1,tick:0},{scan:26,down:0,tick:1500000},
    {scan:5,down:1,tick:2100000},{scan:5,down:0,tick:3600000}
  ]);
  late.send({type:'pause'});assert.equal(late.jobs.size,0);
}

// HP48 and both workbench models retain their existing creation defaults.
for(const [options,hold,gap] of [
  [{model:4},600000,360000],
  [{model:1,audience:'debug'},2000000,2000000],
  [{model:4,audience:'debug'},2000000,2000000],
]) {
  const f=fixture(150000000,{speed:0,...options});
  assert.equal(f.input().hold,hold);assert.equal(f.input().gap,gap);
  f.send({type:'tap-sequence',scans:[26,5]});pumpUntil(f,()=>f.presses.length===4);
  assert.deepEqual(f.presses,[
    {scan:26,down:1,tick:0},{scan:26,down:0,tick:hold},
    {scan:5,down:1,tick:hold+gap},{scan:5,down:0,tick:2*hold+gap}
  ]);
  assert(f.policies.every(name=>name==='legacy'));
  f.send({type:'pause'});assert.equal(f.jobs.size,0);
}

for(const speed of [.5,1,2]) {
  const fast=fixture(150000000,{speed}),task=fast.pump();
  assert(task.calls<40,`Caught-up ${speed}x pacing spent ${task.calls} core calls catching up`);
  assert(task.ms<1,`Caught-up ${speed}x pacing must return before its 6 ms ceiling`);
  assert(fast.budgets.every(n=>n>=256),'Sub-256 work is retained until a useful batch is ready');
  assert(fast.policies.every(name=>name==='legacy'),'Playable calculators retain the legacy runner; research APIs stay explicit');
  fast.send({type:'pause'});assert.equal(fast.jobs.size,0);
  const beforeStep=fast.budgets.length;
  fast.send({type:'step'});
  assert.equal(fast.budgets.length,beforeStep+1);
  assert.equal(fast.budgets.at(-1),1,'A paused step retains one legacy quantum');
  assert.equal(fast.policies.at(-1),'legacy','Single-step must not select a research runner');
  assert.equal(fast.jobs.size,0,'Single-step must not resume the Worker');
}

// A slow host already has useful pending work and must retain the full task
// budget. The new waiting threshold must not create additional idle time.
const slow=fixture(8000000),slowTask=slow.pump();
assert(slowTask.calls>=45&&slowTask.ticks>=46000);
assert(slowTask.ms>=6&&slowTask.ms<6.2);
assert(slow.budgets.every(n=>n===1024));
slow.send({type:'pause'});

const unlimited=fixture(150000000,{speed:0}),unlimitedTask=unlimited.pump();
assert(unlimitedTask.ms>=6);assert(unlimited.budgets.every(n=>n===1024));
unlimited.send({type:'pause'});

for(const options of [{audience:'debug'},{preset:'strict'}]){
  const legacy=fixture(48000000,{speed:0,...options});legacy.pump();
  assert(legacy.policies.length>0&&legacy.policies.every(name=>name==='legacy'),
    'Workbench and unsupported presets preserve the legacy runner');
  legacy.send({type:'pause'});
}

// Use sub-batch key boundaries deliberately: complete each physical hold/gap
// at its exact virtual tick, including successive taps inside one Worker task.
const keys=fixture(48000000);keys.syntheticTiming(300,70);
keys.send({type:'tap-sequence',scans:[26,5,26,6]});keys.pump();
assert.deepEqual(keys.presses,[
  {scan:26,down:1,tick:0},{scan:26,down:0,tick:300},
  {scan:5,down:1,tick:370},{scan:5,down:0,tick:670},
  {scan:26,down:1,tick:740},{scan:26,down:0,tick:1040},
  {scan:6,down:1,tick:1110},{scan:6,down:0,tick:1410}
]);
assert(keys.budgets.includes(70),'Input boundaries smaller than the pacing batch are executed exactly');
keys.send({type:'pause'});assert.equal(keys.jobs.size,0);

console.log('Worker pacing: real create defaults; exact HP39 125/50 ms contacts and late-gap taps at .5/1/2/Unlimited; unchanged HP48/workbench timing; legacy run/step and bounded pacing pass.');

for(const speed of [.5,1,2,0]){
  const f=fixture(150000000,{speed});
  f.send({type:'key-down',source:'keyboard:ArrowLeft',scan:43});
  pumpUntil(f,()=>f.input().tick>=4500000);
  assert.deepEqual(f.presses,[{scan:43,down:1,tick:0}],'A held key must not turn into periodic taps');
  f.send({type:'key-up',source:'keyboard:ArrowLeft'});
  assert.deepEqual(f.presses.at(-1),{scan:43,down:0,tick:f.input().tick});
  f.send({type:'key-down',source:'pointer:1',scan:45});f.send({type:'key-up',source:'pointer:1'});
  pumpUntil(f,()=>f.presses.length===4);
  assert.equal(f.presses[3].tick-f.presses[2].tick,1500000,'Short pointer clicks retain original 39g+ debounce');
  f.send({type:'key-down',source:'keyboard:ArrowUp',scan:42});pumpUntil(f,()=>f.presses.length===5);
  f.send({type:'pause'});assert.equal(f.input().pending,0);assert.equal(f.presses.at(-1).down,0);
  assert.equal(f.jobs.size,0);
}
console.log('Worker held input: real down/up commands at all four rates preserve sustained contacts, short-click debounce and pause cleanup.');
