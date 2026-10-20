// SPDX-License-Identifier: MIT
// Execute the real Worker pump against an advancing, high-resolution clock.
// This makes its host-work amplification deterministic; it is not a firmware
// benchmark or a physical-clock oracle. Production-WASM RTC/replay tests are
// separate gates.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Pacer} from '../web/pacing.js';
import {TapQueue,isPlayable,setupHash,applySetup} from '../web/hp48.js';

const source=readFileSync(process.env.ORCHARD_WORKER_PATH||new URL('../web/worker.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').split('\ntry {\n  const response=await fetch')[0];
function fixture(hostHz,{speed=1,hold=1500000,gap=900000,audience='calculator',preset='hp39-home'}={}) {
  let clock=0,wall=0,next=0,clockReads=0;
  const jobs=new Map(),budgets=[],policies=[],presses=[],output=[];
  const memory={buffer:new ArrayBuffer(16384)};
  const run=(policy,n)=>{policies.push(policy);budgets.push(n);wall+=0.0003+n/(hostHz/1000);clock+=n;return 0;};
  const core=new Proxy({
    memory,
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
  const scope={Pacer,TaskScheduler:Scheduler,TapQueue,isPlayable,setupHash,applySetup,
    Uint32Array,Uint8Array,ArrayBuffer,self:{},postMessage:d=>output.push(d),initialCore:core,
    // 250 ns for a monotonic-clock read, 300 ns fixed host cost per core call;
    // the requested hostHz supplies only the per-tick cost. Faster clock reads
    // remain above one guest quantum on common high-resolution Node clocks.
    performance:{now:()=>{++clockReads;return wall+=0.00025;}}};
  vm.runInNewContext(source+`\ncore=initialCore;model=1;generation=1;preset=${JSON.stringify(preset)};audience=${JSON.stringify(audience)};loaded=true;tick=0;taps.hold=${hold};taps.gap=${gap};\n`,scope);
  const send=data=>scope.self.onmessage({data:{generation:1,...data}});
  send({type:'configure',speed});send({type:'run'});
  return {send,budgets,policies,presses,output,jobs,
    pump(){
      const entry=jobs.entries().next().value;assert.ok(entry,'Worker must schedule its continuation');
      jobs.delete(entry[0]);wall=Math.max(wall,entry[1].at);
      const start=wall,first=budgets.length;entry[1].fn();
      assert(!output.some(x=>x.type==='error'),JSON.stringify(output));
      assert(budgets.every(n=>Number.isSafeInteger(n)&&n>0&&n<=1024),'All core calls stay UART-bounded');
      return {ms:wall-start,calls:budgets.length-first,ticks:clock,clockReads};
    }
  };
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
const keys=fixture(48000000,{hold:300,gap:70});
keys.send({type:'tap-sequence',scans:[26,5,26,6]});keys.pump();
assert.deepEqual(keys.presses,[
  {scan:26,down:1,tick:0},{scan:26,down:0,tick:300},
  {scan:5,down:1,tick:370},{scan:5,down:0,tick:670},
  {scan:26,down:1,tick:740},{scan:26,down:0,tick:1040},
  {scan:6,down:1,tick:1110},{scan:6,down:0,tick:1410}
]);
assert(keys.budgets.includes(70),'Input boundaries smaller than the pacing batch are executed exactly');
keys.send({type:'pause'});assert.equal(keys.jobs.size,0);

console.log('Worker pacing: legacy run/step; no caught-up self-spin at 0.5/1/2x; slow/unlimited hosts retain work; exact sub-batch key events and pause cancellation pass.');
